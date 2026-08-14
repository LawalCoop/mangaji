import type * as Ort from "onnxruntime-web";
import { boundsOf, convexHull, largestComponent, open, polygonArea, simplify, traceContour, type Point } from "./vision";

/**
 * Detección de viñetas, globos y texto en el navegador.
 *
 * Corren dos modelos, cada uno en lo que gana: el de segmentación aporta las máscaras de
 * viñeta —de ahí salen los trapecios— y el dedicado lee el diálogo mucho mejor. Sobre una
 * página real, a un mismo globo el primero le da 0.002 de confianza y el segundo 0.659, así
 * que sus salidas se unen en vez de reemplazarse.
 *
 * Los modelos traen la supresión de no-máximos incorporada: su salida ya son detecciones
 * filtradas, con las máscaras como coeficientes que multiplican los prototipos.
 */

export type DetectionClass = "frame" | "text" | "balloon";

export type Detection = {
  cls: DetectionClass;
  conf: number;
  bbox: { x: number; y: number; w: number; h: number };
  polygon: Point[];
};

const SIZE = 1280;
const CLASSES: DetectionClass[] = ["frame", "text", "balloon"];

/**
 * Umbral de confianza por clase.
 *
 * `text` va mucho más bajo a propósito: los modelos se entrenaron sobre japonés vertical y
 * con diálogo latino horizontal les baja la confianza, justo en los globos con más texto.
 * Es seguro porque el texto solo se levanta del arte si su fondo es papel.
 */
const CONF: Record<DetectionClass, number> = { frame: 0.25, balloon: 0.25, text: 0.05 };
const TEXT_MODEL_CONF = 0.12;
/** Dos bloques de texto que se solapan más que esto son el mismo, visto por ambos modelos. */
const TEXT_MERGE_IOU = 0.4;
/** Douglas-Peucker en píxeles: 202 vértices de mediana quedan en unos 20. */
const SIMPLIFY_EPS = 2;
/** Por encima de esta relación área/casco la viñeta se considera convexa y se usa el casco. */
const CONVEX_RATIO = 0.93;

export type Progress = (stage: string, detail?: string) => void;

/**
 * El entorno de onnxruntime se configura una sola vez por sesión.
 *
 * Estos ajustes solo se pueden tocar antes de que el runtime arranque: al segundo intento
 * ORT responde "Session already started" y falla la carga. Como el detector se crea de nuevo
 * en cada procesamiento, la configuración tiene que quedar afuera.
 */
let configured = false;

function configure(ort: typeof Ort): void {
  if (configured) return;
  ort.env.wasm.wasmPaths = "/ort/";
  ort.env.wasm.numThreads = navigator.hardwareConcurrency ?? 4;
  ort.env.logLevel = "error";
  configured = true;
}

export class Detector {
  #panels: Ort.InferenceSession;
  #text: Ort.InferenceSession;
  #ort: typeof Ort;

  private constructor(ort: typeof Ort, panels: Ort.InferenceSession, text: Ort.InferenceSession) {
    this.#ort = ort;
    this.#panels = panels;
    this.#text = text;
  }

  /** El backend elegido: `webgpu` es unas quince veces más rápido que `wasm`. */
  static backend: "webgpu" | "wasm" = "wasm";

  static async load(onProgress?: Progress): Promise<Detector> {
    const ort = await import("onnxruntime-web");
    configure(ort);

    const hasGpu =
      "gpu" in navigator && Boolean(await (navigator as unknown as { gpu?: GPU }).gpu?.requestAdapter());
    Detector.backend = hasGpu ? "webgpu" : "wasm";
    onProgress?.(
      "backend",
      hasGpu ? "acelerado por GPU" : "sin GPU: va a tardar bastante más",
    );

    const options: Ort.InferenceSession.SessionOptions = {
      executionProviders: [Detector.backend],
      graphOptimizationLevel: "all",
      // El runtime avisa que las operaciones de forma van a CPU en vez de a la GPU. Es
      // deliberado —ahí son más rápidas— y el aviso sale del lado nativo, así que no lo
      // alcanza `env.logLevel`.
      logSeverityLevel: 3,
    };

    onProgress?.("modelo", "cargando el detector de viñetas");
    const panels = await ort.InferenceSession.create("/models/panels.onnx", options);
    onProgress?.("modelo", "cargando el detector de diálogo");
    const text = await ort.InferenceSession.create("/models/text.onnx", options);

    return new Detector(ort, panels, text);
  }

  async release(): Promise<void> {
    await this.#panels.release();
    await this.#text.release();
  }

  /**
   * Detecta sobre una página ya decodificada.
   *
   * Devuelve las detecciones en coordenadas de la página, no del tensor.
   */
  async detect(image: ImageData): Promise<Detection[]> {
    const { tensor, scale, validW, validH } = this.#prepare(image);

    const [panelOut, textOut] = await Promise.all([
      this.#panels.run({ [this.#panels.inputNames[0]]: tensor }),
      this.#text.run({ [this.#text.inputNames[0]]: tensor }),
    ]);

    const fromPanels = this.#decodeSegmentation(panelOut, image, scale, validW, validH);
    const fromText = this.#decodeBoxes(textOut, scale, image.width, image.height);

    return mergeText(fromPanels, fromText).sort((a, b) => b.conf - a.conf);
  }

  /** Escala a 1280 manteniendo proporción y rellena; la imagen se ancla arriba a la izquierda. */
  #prepare(image: ImageData) {
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = "#727272";
    ctx.fillRect(0, 0, SIZE, SIZE);

    const scale = Math.min(SIZE / image.width, SIZE / image.height);
    const bitmap = new OffscreenCanvas(image.width, image.height);
    bitmap.getContext("2d")!.putImageData(image, 0, 0);
    ctx.drawImage(bitmap, 0, 0, image.width * scale, image.height * scale);

    const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
    const plane = SIZE * SIZE;
    const chw = new Float32Array(3 * plane);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      chw[p] = data[i] / 255;
      chw[plane + p] = data[i + 1] / 255;
      chw[2 * plane + p] = data[i + 2] / 255;
    }

    return {
      tensor: new this.#ort.Tensor("float32", chw, [1, 3, SIZE, SIZE]),
      scale,
      validW: Math.round(image.width * scale),
      validH: Math.round(image.height * scale),
    };
  }

  /**
   * Salida del modelo de segmentación: `[1, 300, 38]` y los prototipos de máscara.
   *
   * Las 38 columnas son la caja en xyxy, la confianza, la clase y 32 coeficientes que
   * multiplican los prototipos para reconstruir la máscara de esa instancia.
   */
  #decodeSegmentation(
    output: Ort.InferenceSession.OnnxValueMapType,
    image: ImageData,
    scale: number,
    validW: number,
    validH: number,
  ): Detection[] {
    const names = Object.keys(output);
    const preds = output[names[0]];
    const protos = output[names[1]];
    const rows = preds.data as Float32Array;
    const [, count, stride] = preds.dims as number[];
    const [, channels, protoH, protoW] = protos.dims as number[];
    const protoData = protos.data as Float32Array;

    const out: Detection[] = [];
    const vw = Math.round((validW * protoW) / SIZE);
    const vh = Math.round((validH * protoH) / SIZE);

    for (let i = 0; i < count; i++) {
      const base = i * stride;
      const conf = rows[base + 4];
      const cls = CLASSES[rows[base + 5]] ?? "frame";
      if (conf < CONF[cls]) continue;

      const x1 = rows[base];
      const y1 = rows[base + 1];
      const x2 = rows[base + 2];
      const y2 = rows[base + 3];

      // La máscara: sigmoide de la combinación de prototipos, recortada a la caja para que
      // no sangre a las viñetas vecinas.
      const bx1 = Math.max(0, Math.floor((x1 * protoW) / SIZE));
      const by1 = Math.max(0, Math.floor((y1 * protoH) / SIZE));
      const bx2 = Math.min(vw, Math.ceil((x2 * protoW) / SIZE));
      const by2 = Math.min(vh, Math.ceil((y2 * protoH) / SIZE));
      if (bx2 <= bx1 || by2 <= by1) continue;

      const small = new Float32Array(vw * vh);
      for (let y = by1; y < by2; y++) {
        for (let x = bx1; x < bx2; x++) {
          let sum = 0;
          for (let c = 0; c < channels; c++) {
            sum += rows[base + 6 + c] * protoData[c * protoH * protoW + y * protoW + x];
          }
          small[y * vw + x] = 1 / (1 + Math.exp(-sum));
        }
      }

      const polygon = this.#maskToPolygon(small, vw, vh, image.width, image.height);
      if (!polygon) continue;

      out.push({ cls, conf, bbox: boundsOf(polygon), polygon });
    }
    return out;
  }

  /**
   * Lleva la máscara al tamaño de la página y saca su silueta.
   *
   * Se interpola la probabilidad y recién después se umbraliza: escalar la máscara ya
   * binarizada convierte cada píxel de los prototipos —un cuarto de resolución— en un
   * escalón visible en el borde.
   */
  #maskToPolygon(
    small: Float32Array,
    sw: number,
    sh: number,
    width: number,
    height: number,
  ): Point[] | null {
    const mask = new Uint8Array(width * height);
    let any = false;
    for (let y = 0; y < height; y++) {
      const sy = (y * sh) / height - 0.5;
      const y0 = Math.max(0, Math.min(sh - 1, Math.floor(sy)));
      const y1 = Math.min(sh - 1, y0 + 1);
      const fy = Math.max(0, Math.min(1, sy - y0));
      for (let x = 0; x < width; x++) {
        const sx = (x * sw) / width - 0.5;
        const x0 = Math.max(0, Math.min(sw - 1, Math.floor(sx)));
        const x1 = Math.min(sw - 1, x0 + 1);
        const fx = Math.max(0, Math.min(1, sx - x0));

        const top = small[y0 * sw + x0] * (1 - fx) + small[y0 * sw + x1] * fx;
        const bottom = small[y1 * sw + x0] * (1 - fx) + small[y1 * sw + x1] * fx;
        if (top * (1 - fy) + bottom * fy > 0.5) {
          mask[y * width + x] = 1;
          any = true;
        }
      }
    }
    if (!any) return null;

    const clean = largestComponent(open(mask, width, height, 2), width, height);
    const contour = traceContour(clean, width, height);
    if (contour.length < 3) return null;

    // Un marco de manga es un polígono de lados rectos: si el contorno es casi convexo, su
    // casco es esa forma ideal, y seguir el borde crudo solo copia el escalonado.
    const hull = convexHull(contour);
    const useHull = hull.length >= 3 && polygonArea(contour) / polygonArea(hull) >= CONVEX_RATIO;
    const simple = simplify(useHull ? hull : contour, SIMPLIFY_EPS);
    return simple.length >= 3 ? simple : null;
  }

  /** Salida del modelo de texto: `[1, 300, 6]`, solo cajas. */
  #decodeBoxes(
    output: Ort.InferenceSession.OnnxValueMapType,
    scale: number,
    width: number,
    height: number,
  ): Detection[] {
    const preds = output[Object.keys(output)[0]];
    const rows = preds.data as Float32Array;
    const [, count, stride] = preds.dims as number[];

    const out: Detection[] = [];
    for (let i = 0; i < count; i++) {
      const base = i * stride;
      const conf = rows[base + 4];
      // Este modelo solo tiene dos clases y la que interesa es el texto.
      if (conf < TEXT_MODEL_CONF || rows[base + 5] !== 1) continue;

      const x1 = Math.max(0, rows[base] / scale);
      const y1 = Math.max(0, rows[base + 1] / scale);
      const x2 = Math.min(width, rows[base + 2] / scale);
      const y2 = Math.min(height, rows[base + 3] / scale);
      if (x2 - x1 < 2 || y2 - y1 < 2) continue;

      out.push({
        cls: "text",
        conf,
        bbox: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 },
        polygon: [
          [x1, y1],
          [x2, y1],
          [x2, y2],
          [x1, y2],
        ],
      });
    }
    return out;
  }
}

const iou = (a: Detection["bbox"], b: Detection["bbox"]) => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
};

/** Suma los bloques del segundo detector sin duplicar los que el primero ya encontró. */
function mergeText(primary: Detection[], extra: Detection[]): Detection[] {
  const out = [...primary];
  const existing = primary.filter((d) => d.cls === "text");
  for (const det of extra) {
    if (existing.every((e) => iou(det.bbox, e.bbox) < TEXT_MERGE_IOU)) {
      out.push(det);
      existing.push(det);
    }
  }
  return out;
}

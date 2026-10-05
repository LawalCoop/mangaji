import type * as Ort from "onnxruntime-web";
import { boundsOf, convexHull, largestComponent, open, polygonArea, resizeToPlanes, simplify, traceContour, type Point } from "./vision";
import { asset } from "./base";
import type { Note } from "./notes";
import { SHAPE_CONF } from "./panels";

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
  /** Texto suelto, fuera de un globo, según el detector de texto. */
  free?: boolean;
  /** Texto hallado en la página invertida: letra clara sobre fondo oscuro. */
  light?: boolean;
};

const SIZE = 1280;
const CLASSES: DetectionClass[] = ["frame", "text", "balloon"];

/**
 * Umbral de confianza por clase.
 *
 * `text` va mucho más bajo a propósito: los modelos se entrenaron sobre japonés vertical y
 * con diálogo latino horizontal les baja la confianza, justo en los globos con más texto.
 * Es seguro porque el texto solo se levanta del arte si su fondo es papel.
 *
 * `frame` también va bajo, pero no porque todas pasen: las dudosas llegan a lib/panels.ts,
 * que solo las usa para cubrir zonas que ninguna viñeta segura reclama.
 */
const CONF: Record<DetectionClass, number> = { frame: SHAPE_CONF, balloon: 0.25, text: 0.05 };
const TEXT_MODEL_CONF = 0.3;
/** Cuánto se agranda cada caja de texto, por lado, en proporción a su tamaño. */
const TEXT_GROW = 0.08;
/** Pero no más que esto, en píxeles: en un texto grande, agrandar mucho alcanza el contorno del globo. */
const TEXT_GROW_MAX = 12;
/** Lado del cuadrado que ve el detector de texto. */
const TEXT_SIZE = 640;
/** Con esta fracción de la página en manchas negras se busca también letra blanca sobre negro. */
export const INVERT_DARK_SHARE = 0.03;
/** Con esta fracción de la página en colores fuertes se busca también texto por brillo. */
export const COLOR_PAGE_SHARE = 0.1;
/** Dos bloques de texto que se solapan más que esto son el mismo, visto por ambos modelos. */
const TEXT_MERGE_IOU = 0.4;
/** Douglas-Peucker en píxeles: 202 vértices de mediana quedan en unos 20. */
const SIMPLIFY_EPS = 2;
/** Por encima de esta relación área/casco la viñeta se considera convexa y se usa el casco. */
const CONVEX_RATIO = 0.93;
/** Gris del relleno alrededor de la página, el mismo que usa Ultralytics. */
const PAD = 114;

export type Progress = (note: Note) => void;

/**
 * El entorno de onnxruntime se configura una sola vez por página, porque estos ajustes solo
 * tienen efecto antes de que el runtime arranque.
 *
 * La marca va en el objeto global y no en el módulo: el recambio en caliente reinicia el
 * módulo mientras el runtime sigue vivo, y una marca de módulo se perdería justo ahí.
 */
const FLAG = "__mangaji_ort_ready__";

function configure(ort: typeof Ort): void {
  const global = globalThis as Record<string, unknown>;
  if (global[FLAG]) return;
  ort.env.wasm.wasmPaths = asset("/ort/");
  // Los hilos de WebAssembly necesitan memoria compartida, y el navegador solo la habilita
  // en páginas aisladas. Pedir doce sin eso no los da y encima avisa por consola.
  // Un núcleo queda libre para el hilo que dibuja: con todos ocupados en la inferencia, la
  // lectura iba a tirones mientras se procesaba el resto del tomo.
  // En el celular, la mitad: con todos menos uno, el dibujo de la lectura iba a tirones.
  const cores = navigator.hardwareConcurrency ?? 4;
  const threads = isMobile() ? Math.max(1, Math.floor(cores / 2)) : Math.max(1, cores - 1);
  ort.env.wasm.numThreads = crossOriginIsolated ? threads : 1;
  ort.env.logLevel = "error";
  global[FLAG] = true;
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

  /**
   * Se espera antes de cada inferencia. En el celular la placa de video es una sola: una
   * inferencia que coincide con un movimiento de cámara le quita los cuadros al dibujo. Así
   * la página se procesa de a tramos, entre movimiento y movimiento.
   */
  static pause: (() => Promise<void>) | null = null;

  /**
   * Baja los modelos y arma las sesiones.
   *
   * `onDownload` recibe cuánto de los modelos llegó, de 0 a 1: la primera vez son unos
   * 50 MB y es lo que más tarda antes de poder leer, así que tiene que verse avanzar.
   */
  static async load(onProgress?: Progress, onDownload?: (fraction: number) => void): Promise<Detector> {
    const ort = await import("onnxruntime-web");
    configure(ort);

    // En el celular, nunca en la placa de video: es una sola, chica, y la comparte con el
    // dibujo de la lectura. Medido en un celular con Mali-G57, cada búsqueda de viñetas la
    // tomaba varios segundos seguidos sin dejarla libre, y la lectura se congelaba de a ratos
    // de hasta dos segundos. En el procesador tarda parecido y corre en otros núcleos.
    const hasGpu =
      !isMobile() &&
      "gpu" in navigator &&
      Boolean(await (navigator as unknown as { gpu?: GPU }).gpu?.requestAdapter());
    Detector.backend = hasGpu ? "webgpu" : "wasm";
    onProgress?.({ key: hasGpu ? "gpu" : "noGpu" });

    const options: Ort.InferenceSession.SessionOptions = {
      executionProviders: [Detector.backend],
      graphOptimizationLevel: "all",
      // El runtime avisa que las operaciones de forma van a CPU en vez de a la GPU. Es
      // deliberado —ahí son más rápidas— y el aviso sale del lado nativo, así que no lo
      // alcanza `env.logLevel`.
      logSeverityLevel: 3,
    };

    // Se bajan acá y no dentro de onnxruntime, que no avisa cuánto lleva.
    onProgress?.({ key: "downloadingModels" });
    const [panelBytes, textBytes] = await downloadAll(
      [asset("/models/panels.onnx"), asset("/models/bubbles.onnx")],
      onDownload,
    );

    onProgress?.({ key: "loadingPanels" });
    const panels = await ort.InferenceSession.create(panelBytes, options);
    onProgress?.({ key: "loadingDialogue" });
    // El de texto, siempre en el procesador: viene cuantizado a 8 bits y la placa de video no
    // lo carga ("ceil() in shape computation is not yet supported for MaxPool"). Es chico y a
    // 640 px, así que en el procesador anda bien.
    const text = await ort.InferenceSession.create(textBytes, { ...options, executionProviders: ["wasm"] });

    return new Detector(ort, panels, text);
  }

  /**
   * Arma el detector con un runtime y modelos que ya tiene quien llama: en el servidor,
   * onnxruntime-node con los archivos del disco. El lector usa `load`.
   */
  static async create(
    ort: typeof Ort,
    panelBytes: Uint8Array,
    textBytes: Uint8Array,
    executionProviders: string[] = ["cpu"],
    extra: Partial<Ort.InferenceSession.SessionOptions> = {},
  ): Promise<Detector> {
    const options: Ort.InferenceSession.SessionOptions = {
      executionProviders,
      graphOptimizationLevel: "all",
      logSeverityLevel: 3,
      ...extra,
    };
    const panels = await ort.InferenceSession.create(panelBytes, options);
    const text = await ort.InferenceSession.create(textBytes, options);
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

    // Uno después del otro, no en paralelo: el runtime admite una sola inferencia por vez y
    // rechaza la segunda con "Session already started". Tampoco habría nada que ganar, porque
    // las dos sesiones comparten los mismos hilos.
    await Detector.pause?.();
    const panelOut = await this.#panels.run({ [this.#panels.inputNames[0]]: tensor });
    const fromPanels = decodeSegmentation(panelOut, image, scale, validW, validH);

    // El de texto ve la página estirada a 640×640 y devuelve las cajas ya en la medida de la
    // página. Distingue el texto suelto, sobre el dibujo, que el de viñetas casi no ve.
    const page = this.#prepareText(image);
    const size = new this.#ort.Tensor("int64", BigInt64Array.from([BigInt(image.width), BigInt(image.height)]), [1, 2]);
    const text = async (planes: Float32Array) => {
      await Detector.pause?.();
      return this.#text.run({ images: new this.#ort.Tensor("float32", planes, [1, 3, TEXT_SIZE, TEXT_SIZE]), orig_target_sizes: size });
    };
    let fromText = decodeText(await text(page), image.width, image.height);

    // Los modelos aprendieron letra oscura sobre blanco: la letra blanca sobre negro —un
    // grito dentro de una mancha negra— no la ven. Con la página invertida pasa a ser letra
    // oscura sobre blanco y el de texto la encuentra. Solo en páginas con bastante negro:
    // en las demás no hay nada que buscar y sería una inferencia más por página.
    if (darkShare(image) >= INVERT_DARK_SHARE) {
      const inverted = new Float32Array(page.length);
      for (let i = 0; i < page.length; i++) inverted[i] = 1 - page[i];
      // Solo lo que de verdad es letra clara sobre fondo oscuro. En negativo, una trama de
      // puntos sobre blanco —la letra de una onomatopeya— también parece texto, y se borraba
      // dejando un rectángulo blanco en el dibujo.
      const light = decodeText(await text(inverted), image.width, image.height)
        .filter((d) => onDark(image, d.bbox))
        .map((d) => ({ ...d, light: true }));
      fromText = mergeText(fromText, light);
    }

    // Letra negra sobre un color fuerte —un estallido rojo— tampoco la ven: aprendieron
    // sobre blanco y negro. Mirando solo el brillo, el rojo pasa a ser papel y la letra queda
    // negra sobre blanco. Solo en páginas con bastante color.
    if (colorShare(image) >= COLOR_PAGE_SHARE) {
      const plane = TEXT_SIZE * TEXT_SIZE;
      const light = new Float32Array(page.length);
      for (let i = 0; i < plane; i++) {
        const v = Math.max(page[i], page[plane + i], page[2 * plane + i]);
        light[i] = light[plane + i] = light[2 * plane + i] = v;
      }
      fromText = mergeText(fromText, decodeText(await text(light), image.width, image.height));
    }

    return mergeText(fromPanels, fromText).sort((a, b) => b.conf - a.conf);
  }

  /** Para el de texto: la página estirada a 640×640, sin normalizar (así se entrenó). */
  #prepareText(image: ImageData): Float32Array {
    return resizeToPlanes(image.data, image.width, image.height, TEXT_SIZE, TEXT_SIZE, TEXT_SIZE, 0);
  }

  /** Escala a 1280 manteniendo proporción y rellena; la imagen se ancla arriba a la izquierda. */
  #prepare(image: ImageData) {
    const scale = Math.min(SIZE / image.width, SIZE / image.height);
    const validW = Math.round(image.width * scale);
    const validH = Math.round(image.height * scale);
    const chw = resizeToPlanes(image.data, image.width, image.height, validW, validH, SIZE, PAD);

    return {
      tensor: new this.#ort.Tensor("float32", chw, [1, 3, SIZE, SIZE]),
      scale,
      validW,
      validH,
    };
  }


}

/**
 * Salida del modelo de segmentación: `[1, 300, 38]` y los prototipos de máscara.
 *
 * Las 38 columnas son la caja en xyxy, la confianza, la clase y 32 coeficientes que
 * multiplican los prototipos para reconstruir la máscara de esa instancia.
 */
export function decodeSegmentation(
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

    const polygon = maskToPolygon(small, vw, vh, image.width, image.height, {
      x1: bx1,
      y1: by1,
      x2: bx2,
      y2: by2,
    });
    if (!polygon) continue;

    out.push({ cls, conf, bbox: boundsOf(polygon), polygon });
  }
  return out;
}

/** Salida del modelo de texto: `[1, 300, 6]`, solo cajas. */
/**
 * Salida del detector de texto (RT-DETR, ogkalu/comic-text-and-bubble-detector): cajas ya en
 * la medida de la página, con clase 0 globo, 1 texto en globo y 2 texto suelto. Se usa el
 * texto; los globos los da el modelo de viñetas, con su forma.
 */
export function decodeText(
  output: Ort.InferenceSession.OnnxValueMapType,
  width: number,
  height: number,
  minConf = TEXT_MODEL_CONF,
): Detection[] {
  const labels = output.labels.data as BigInt64Array;
  const boxes = output.boxes.data as Float32Array;
  const scores = output.scores.data as Float32Array;
  const out: Detection[] = [];
  for (let i = 0; i < scores.length; i++) {
    const conf = scores[i];
    if (conf < minConf || Number(labels[i]) === 0) continue;
    // Las cajas de este modelo son justas y a veces cortan la última letra de cada renglón:
    // se agrandan un poco, que la extracción ya sabe ignorar el aire de más.
    const bw = boxes[i * 4 + 2] - boxes[i * 4];
    const bh = boxes[i * 4 + 3] - boxes[i * 4 + 1];
    // Agranda más los textos chicos que los grandes: en uno grande, mucho aire alcanza el
    // contorno del globo; en uno chico, poco aire corta letras.
    const px = Math.min(TEXT_GROW_MAX, Math.max(3, bw * TEXT_GROW));
    const py = Math.min(TEXT_GROW_MAX, Math.max(3, bh * TEXT_GROW));
    const x1 = Math.max(0, boxes[i * 4] - px);
    const y1 = Math.max(0, boxes[i * 4 + 1] - py);
    const x2 = Math.min(width, boxes[i * 4 + 2] + px);
    const y2 = Math.min(height, boxes[i * 4 + 3] + py);
    if (x2 - x1 < 2 || y2 - y1 < 2) continue;
    out.push({
      cls: "text",
      conf,
      free: Number(labels[i]) === 2,
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

const iou = (a: Detection["bbox"], b: Detection["bbox"]) => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
};

/** Suma los bloques del segundo detector sin duplicar los que el primero ya encontró. */
export function mergeText(primary: Detection[], extra: Detection[]): Detection[] {
  const out = [...primary];
  for (const det of extra) {
    // Un texto que los dos ven es uno solo: queda el de más confianza, que suele ser el
    // mejor encuadrado. Quedarse siempre con el primero dejaba a veces una caja chica de
    // 0.07 en lugar de una de 0.90 que abarcaba todo el texto.
    const twin = out.findIndex((e) => e.cls === "text" && iou(det.bbox, e.bbox) >= TEXT_MERGE_IOU);
    if (twin < 0) out.push(det);
    else if (det.conf > out[twin].conf) out[twin] = det;
  }
  return out;
}

/** Margen del recorte, en píxeles de página: más que el radio de la apertura morfológica. */
const CROP_MARGIN = 4;
/** Radio de la apertura que corta los hilos de un píxel de las máscaras. */
const OPEN_RADIUS = 2;

/**
 * Lleva la máscara al tamaño de la página y saca su silueta.
 *
 * Se interpola la probabilidad y recién después se umbraliza: escalar la máscara ya
 * binarizada convierte cada píxel de los prototipos —un cuarto de resolución— en un
 * escalón visible en el borde.
 *
 * `cells` es la caja de la detección en celdas de los prototipos, fuera de la cual la
 * máscara vale cero. Con ella se trabaja solo sobre la zona que la interpolación puede
 * alcanzar, más un margen; antes se recorría la página entera por cada detección, y en una
 * página con veinte eran millones de píxeles para calcular ceros. El resultado es el mismo:
 * fuera del recorte todo es fondo, y la apertura, los componentes y el contorno tratan el
 * borde del recorte también como fondo.
 */
export function maskToPolygon(
  small: Float32Array,
  sw: number,
  sh: number,
  width: number,
  height: number,
  cells?: { x1: number; y1: number; x2: number; y2: number },
): Point[] | null {
  // Un píxel de página toca las celdas `floor(s)` y la siguiente, con s = p·sw/ancho − 0.5.
  // Solo puede valer algo si alguna cae dentro de [x1, x2).
  const reach = (lo: number, hi: number, cellsN: number, pixels: number) =>
    cells
      ? [
          Math.max(0, Math.floor(((lo - 0.5) * pixels) / cellsN) - CROP_MARGIN),
          Math.min(pixels, Math.ceil(((hi + 0.5) * pixels) / cellsN) + CROP_MARGIN),
        ]
      : [0, pixels];
  const [cx0, cx1] = reach(cells?.x1 ?? 0, cells?.x2 ?? 0, sw, width);
  const [cy0, cy1] = reach(cells?.y1 ?? 0, cells?.y2 ?? 0, sh, height);
  const cw = cx1 - cx0;
  const ch = cy1 - cy0;
  if (cw <= 0 || ch <= 0) return null;

  const mask = new Uint8Array(cw * ch);
  let any = false;
  for (let y = cy0; y < cy1; y++) {
    const sy = (y * sh) / height - 0.5;
    const y0 = Math.max(0, Math.min(sh - 1, Math.floor(sy)));
    const y1 = Math.min(sh - 1, y0 + 1);
    const fy = Math.max(0, Math.min(1, sy - y0));
    for (let x = cx0; x < cx1; x++) {
      const sx = (x * sw) / width - 0.5;
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(sx)));
      const x1 = Math.min(sw - 1, x0 + 1);
      const fx = Math.max(0, Math.min(1, sx - x0));

      const top = small[y0 * sw + x0] * (1 - fx) + small[y0 * sw + x1] * fx;
      const bottom = small[y1 * sw + x0] * (1 - fx) + small[y1 * sw + x1] * fx;
      if (top * (1 - fy) + bottom * fy > 0.5) {
        mask[(y - cy0) * cw + (x - cx0)] = 1;
        any = true;
      }
    }
  }
  if (!any) return null;

  const clean = largestComponent(open(mask, cw, ch, OPEN_RADIUS), cw, ch);
  const contour = traceContour(clean, cw, ch).map(([x, y]): Point => [x + cx0, y + cy0]);
  if (contour.length < 3) return null;

  // Un marco de manga es un polígono de lados rectos: si el contorno es casi convexo, su
  // casco es esa forma ideal, y seguir el borde crudo solo copia el escalonado.
  const hull = convexHull(contour);
  const useHull = hull.length >= 3 && polygonArea(contour) / polygonArea(hull) >= CONVEX_RATIO;
  const simple = simplify(useHull ? hull : contour, SIMPLIFY_EPS);
  return simple.length >= 3 ? simple : null;
}

/**
 * Baja varios archivos a la vez informando el avance conjunto, en bytes.
 *
 * Se piden todos juntos para conocer el tamaño total de entrada; si algún servidor no lo
 * informa, el avance se calcula sobre lo que sí se conoce.
 */
async function downloadAll(urls: string[], onFraction?: (fraction: number) => void): Promise<Uint8Array[]> {
  const responses = await Promise.all(
    urls.map(async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`No se pudo bajar ${url} (${res.status})`);
      return res;
    }),
  );
  const totals = responses.map((r) => Number(r.headers.get("content-length")) || 0);
  const total = totals.reduce((a, b) => a + b, 0);
  const received = responses.map(() => 0);
  const report = () => {
    if (total > 0) onFraction?.(Math.min(1, received.reduce((a, b) => a + b, 0) / total));
  };
  report();

  return Promise.all(
    responses.map(async (res, i) => {
      if (!res.body) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        received[i] = bytes.byteLength;
        report();
        return bytes;
      }
      const chunks: Uint8Array[] = [];
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received[i] += value.byteLength;
        report();
      }
      // Un solo bloque contiguo: es lo que espera onnxruntime.
      const bytes = new Uint8Array(received[i]);
      let at = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.byteLength;
      }
      return bytes;
    }),
  );
}

/**
 * Qué fracción de la página son manchas negras sólidas.
 *
 * Se cuentan bloques casi enteramente negros, no píxeles: las líneas de tinta suman un 10 %
 * de negro en cualquier página y no llenan ningún bloque; una mancha negra sí.
 */
export function darkShare(image: ImageData): number {
  const { data, width, height } = image;
  const side = Math.max(8, Math.floor(width / 64));
  let solid = 0;
  let total = 0;
  for (let by = 0; by + side <= height; by += side) {
    for (let bx = 0; bx + side <= width; bx += side) {
      total++;
      let dark = 0;
      let seen = 0;
      for (let y = by; y < by + side; y += 2) {
        for (let x = bx; x < bx + side; x += 2) {
          const i = (y * width + x) * 4;
          seen++;
          if (Math.max(data[i], data[i + 1], data[i + 2]) < 50) dark++;
        }
      }
      if (dark >= seen * 0.9) solid++;
    }
  }
  return total ? solid / total : 0;
}

/** A partir de este brillo, el borde de una caja no es fondo oscuro. */
const DARK_BACKDROP = 90;
/** Qué parte de la caja tiene que ser oscura. */
const DARK_FILL = 0.55;

/**
 * ¿La caja está sobre fondo oscuro? Se mira la mediana del brillo de su borde, que cae casi
 * todo en el fondo, entre letra y letra.
 */
export function onDark(image: Pick<ImageData, "data" | "width" | "height">, box: Detection["bbox"]): boolean {
  const { data, width, height } = image;
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(width - 1, Math.ceil(box.x + box.w) - 1);
  const y1 = Math.min(height - 1, Math.ceil(box.y + box.h) - 1);
  if (x1 <= x0 || y1 <= y0) return false;
  const levels: number[] = [];
  const take = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    levels.push(Math.max(data[i], data[i + 1], data[i + 2]));
  };
  for (let x = x0; x <= x1; x++) {
    take(x, y0);
    take(x, y1);
  }
  for (let y = y0 + 1; y < y1; y++) {
    take(x0, y);
    take(x1, y);
  }
  levels.sort((a, b) => a - b);
  if (levels[levels.length >> 1] >= DARK_BACKDROP) return false;

  // Y la caja tiene que ser mayormente oscura: en un estallido negro con letra blanca, el
  // 64 %; en un cielo negro salpicado de rocas blancas, que el modelo en negativo también
  // toma por texto, menos de la mitad.
  let dark = 0;
  let total = 0;
  for (let y = y0; y <= y1; y += 2) {
    for (let x = x0; x <= x1; x += 2) {
      const i = (y * width + x) * 4;
      total++;
      if (Math.max(data[i], data[i + 1], data[i + 2]) < 60) dark++;
    }
  }
  return dark / total >= DARK_FILL;
}

/** Qué fracción de la página es de un color fuerte, mirando uno de cada tantos píxeles. */
export function colorShare(image: Pick<ImageData, "data">): number {
  const { data } = image;
  let strong = 0;
  let total = 0;
  for (let i = 0; i < data.length; i += 4 * 7) {
    total++;
    const hi = Math.max(data[i], data[i + 1], data[i + 2]);
    const lo = Math.min(data[i], data[i + 1], data[i + 2]);
    if (hi - lo > 80) strong++;
  }
  return total ? strong / total : 0;
}

/** ¿Corre en un celular o una tableta? Sirve también dentro de un worker. */
function isMobile(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  if (nav.userAgentData?.mobile !== undefined) return nav.userAgentData.mobile;
  return /Android|iPhone|iPad|Mobile/i.test(nav.userAgent);
}

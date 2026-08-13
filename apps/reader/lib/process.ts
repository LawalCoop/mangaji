import { zipSync } from "fflate";
import { Detector, type Detection } from "./detector";
import { insidePolygon, lift, type Sprite } from "./dialogue";
import { readingOrder, type Box } from "./reading-order";
import { polygonArea, type Point } from "./vision";

/**
 * Convierte un CBZ en un `.cbza`: detecta viñetas y diálogo, decide el orden de lectura y la
 * dirección de cada viñeta, y empaqueta todo con el arte.
 *
 * Es el mismo pipeline que corre en Python, con las mismas constantes y salvaguardas. Vive
 * en el navegador porque ahí es más rápido —con GPU, entre cuatro y siete veces— y porque el
 * archivo no tiene que salir de la máquina de quien lee.
 */

/** Descarta fragmentos espurios: una viñeta real nunca es tan chica. */
const MIN_PANEL_AREA = 0.02;
/** Con esta fracción dentro de una viñeta, el globo también le pertenece. */
const SHARED_BALLOON = 0.25;
/** Dos detecciones que se solapan más que esto son la misma, vista dos veces. */
const DEDUPE_IOU = 0.6;

const ENTER_MS = 450;
const REVEAL_MS = 420;
const TAIL_MS = 600;
const READ_MS = { min: 650, max: 2800 };
const READ_SCALE = 240_000;

export type Stage =
  | { kind: "opening"; total?: number }
  | { kind: "models"; detail: string }
  | { kind: "page"; index: number; total: number; detail: string }
  | { kind: "packing" }
  | { kind: "done"; panels: number; balloons: number; ms: number };

export type Reporter = (stage: Stage) => void;

const iou = (a: Detection["bbox"], b: Detection["bbox"]) => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
};

/** Se queda con la detección más confiable de cada grupo solapado. */
function dedupe(dets: Detection[]): Detection[] {
  const kept: Detection[] = [];
  for (const det of [...dets].sort((a, b) => b.conf - a.conf)) {
    if (kept.every((k) => iou(det.bbox, k.bbox) < DEDUPE_IOU)) kept.push(det);
  }
  return kept;
}

const readMs = (ink: number) =>
  Math.round(Math.min(Math.max(READ_MS.min + ink * READ_SCALE, READ_MS.min), READ_MS.max));

/** Cuánta tinta y qué tan alineados están los trazos: de ahí salen la cámara y el efecto. */
function measure(ctx: CanvasRenderingContext2D, polygon: Point[], pageArea: number) {
  const b = polygon.reduce(
    (acc, [x, y]) => ({
      x0: Math.min(acc.x0, x),
      y0: Math.min(acc.y0, y),
      x1: Math.max(acc.x1, x),
      y1: Math.max(acc.y1, y),
    }),
    { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
  );
  const w = Math.max(1, Math.round(b.x1 - b.x0));
  const h = Math.max(1, Math.round(b.y1 - b.y0));
  const region = ctx.getImageData(Math.max(0, b.x0), Math.max(0, b.y0), w, h).data;

  let dark = 0;
  for (let i = 0; i < region.length; i += 4) {
    if (Math.max(region[i], region[i + 1], region[i + 2]) < 110) dark++;
  }

  return {
    ink: dark / (region.length / 4),
    aspect: w / h,
    scale: (w * h) / pageArea,
  };
}

type Look = ReturnType<typeof measure>;

function camera(look: Look) {
  if (look.scale >= 0.55) return { kind: "pullBack" as const, from: 1.18, to: 1 };
  if (look.ink >= 0.42) return { kind: "punchIn" as const, from: 1.22, to: 1 };
  if (look.aspect >= 2.1) return { kind: "panH" as const, dir: "rtl" as const };
  if (look.aspect <= 0.62) return { kind: "tiltV" as const, dir: "down" as const };
  return { kind: "punchIn" as const, from: 1.06, to: 1 };
}

/** A lo sumo un efecto por viñeta, y solo si la medición lo pide. */
function effect(look: Look) {
  if (look.ink >= 0.52) return { kind: "flash" as const, strength: 0.7 };
  if (look.ink >= 0.42) return { kind: "shake" as const, amp: 12 };
  return null;
}

/**
 * De dónde salen las páginas.
 *
 * Se piden de a una y se liberan enseguida, en vez de cargarlas todas antes de empezar: un
 * tomo son doscientas páginas de cuatro megapíxeles, y el archivo además libera los bitmaps
 * que va desalojando de su caché, así que guardarlos deja referencias muertas.
 */
export type PageSource = {
  count: number;
  get: (index: number) => Promise<ImageBitmap>;
  release: (index: number) => void;
};

export async function processArchive(pages: PageSource, report: Reporter): Promise<Blob> {
  const started = performance.now();
  report({ kind: "models", detail: "preparando los detectores" });

  const detector = await Detector.load((_, detail) =>
    report({ kind: "models", detail: detail ?? "" }),
  );

  const files: Record<string, Uint8Array> = {};
  const manifestPages: unknown[] = [];
  let totalPanels = 0;
  let totalBalloons = 0;

  try {
    for (let index = 0; index < pages.count; index++) {
      const bitmap = await pages.get(index);
      const pageId = `p${String(index + 1).padStart(3, "0")}`;
      const width = bitmap.width;
      const height = bitmap.height;
      const pageArea = width * height;

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(bitmap, 0, 0);

      report({ kind: "page", index, total: pages.count, detail: "buscando viñetas" });
      const dets = await detector.detect(ctx.getImageData(0, 0, width, height));

      let panels = dedupe(
        dets.filter((d) => d.cls === "frame" && polygonArea(d.polygon) / pageArea >= MIN_PANEL_AREA),
      );
      const balloons = dedupe(dets.filter((d) => d.cls === "balloon"));
      const texts = dets.filter((d) => d.cls === "text");

      // Una página a sangre sin marco dibujado no produce detecciones: la hoja es la viñeta.
      if (!panels.length) {
        panels = [
          {
            cls: "frame",
            conf: 1,
            bbox: { x: 0, y: 0, w: width, h: height },
            polygon: [
              [0, 0],
              [width, 0],
              [width, height],
              [0, height],
            ],
          },
        ];
      }

      report({
        kind: "page",
        index,
        total: pages.count,
        detail: `${panels.length} viñetas · levantando el diálogo`,
      });

      // Se levanta todo el texto de la página antes de repartirlo: hacerlo por viñeta deja
      // sin levantar los globos que quedan a caballo de un borde diagonal.
      const lifted: { det: Detection; sprite: Sprite }[] = [];
      for (const text of texts) {
        const sprite = await lift(ctx, text, pageArea);
        if (sprite) lifted.push({ det: text, sprite });
      }

      // Los bloques se agrupan por globo: el modelo parte un diálogo largo en varios.
      const taken = new Set<number>();
      const groups: { box: Detection["bbox"]; parts: Sprite[] }[] = [];
      for (const balloon of balloons) {
        const mine = lifted
          .map((l, i) => ({ ...l, i }))
          .filter(({ i, det }) => !taken.has(i) && insideBox(balloon.bbox, det.bbox) >= 0.5);
        if (mine.length) {
          mine.forEach(({ i }) => taken.add(i));
          groups.push({ box: balloon.bbox, parts: mine.map((m) => m.sprite) });
        }
      }
      lifted.forEach((l, i) => {
        if (!taken.has(i)) groups.push({ box: l.det.bbox, parts: [l.sprite] });
      });
      for (const balloon of balloons) {
        if (!groups.some((g) => insideBox(balloon.bbox, g.box) > 0.5)) {
          groups.push({ box: balloon.bbox, parts: [] });
        }
      }

      // Cada grupo va a la viñeta con la que más se solapa, medido contra la silueta: con
      // bordes diagonales las cajas de dos vecinas se pisan y el globo cae en la de al lado.
      const perPanel = new Map<number, { id: string; box: Detection["bbox"]; parts: Sprite[] }[]>();
      groups.forEach((group, gi) => {
        const id = `${pageId}.b${gi}`;
        const shares = panels.map((p) => insidePolygon(p.polygon, group.box));
        const best = shares.indexOf(Math.max(...shares));
        const owners = shares
          .map((s, i) => (s >= SHARED_BALLOON ? i : -1))
          .filter((i) => i >= 0);
        if (!owners.includes(best)) owners.push(best);
        for (const owner of owners.length ? owners : [0]) {
          perPanel.set(owner, [...(perPanel.get(owner) ?? []), { id, ...group }]);
        }
      });

      // Los sprites se componen acá porque el armado del manifest es síncrono. Un globo
      // compartido por dos viñetas se compone una sola vez y las dos apuntan al mismo PNG.
      const pending = new Map<string, { bytes: Uint8Array; rect: Sprite["rect"]; ink: number }>();
      for (const list of perPanel.values()) {
        for (const group of list) {
          if (!group.parts.length || pending.has(group.id)) continue;
          const merged = await mergeSprites(group.parts);
          if (merged) pending.set(group.id, merged);
        }
      }

      const order = readingOrder(
        panels.map((p) => p.bbox as Box),
        { polygons: panels.map((p) => p.polygon) },
      );

      const outPanels = order.map((panelIndex, position) => {
        const panel = panels[panelIndex];
        const mine = perPanel.get(panelIndex) ?? [];
        const inner = readingOrder(mine.map((m) => m.box as Box));

        const outBalloons = inner.map((bi, bpos) => {
          const group = mine[bi];
          const merged = pending.get(group.id) ?? null;
          const sprite = merged ? `sprites/${group.id}.png` : "";
          if (merged) {
            files[sprite] = merged.bytes;
            totalBalloons++;
          }
          return {
            id: group.id,
            order: bpos,
            mode: "text-only",
            sprite,
            bbox: merged
              ? [merged.rect.x, merged.rect.y, merged.rect.w, merged.rect.h]
              : [group.box.x, group.box.y, group.box.w, group.box.h],
            inkArea: merged ? merged.ink : 0,
            reveal: "fade",
          };
        });

        const look = measure(ctx, panel.polygon, pageArea);
        const withSprite = outBalloons.filter((b) => b.sprite);
        const beats: Record<string, unknown>[] = [
          { t: 0, ms: ENTER_MS, cam: camera(look) },
        ];
        const fx = effect(look);
        if (fx) beats.push({ t: Math.max(ENTER_MS - 80, 0), ms: 420, fx });

        let t = ENTER_MS;
        for (const balloon of withSprite) {
          beats.push({ t, ms: REVEAL_MS, reveal: balloon.id });
          t += REVEAL_MS + readMs(balloon.inkArea);
        }
        beats.push({ t, ms: 0, hold: TAIL_MS });

        return {
          id: `${pageId}.k${position}`,
          order: position,
          polygon: panel.polygon.map(([x, y]) => [Math.round(x), Math.round(y)]),
          bbox: [panel.bbox.x, panel.bbox.y, panel.bbox.w, panel.bbox.h].map((v) => Math.round(v)),
          confidence: Number(panel.conf.toFixed(3)),
          balloons: outBalloons,
          beats,
        };
      });

      totalPanels += outPanels.length;

      // El arte se guarda ya sin el diálogo, así que hay que recodificarlo.
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((b) => resolve(b!), "image/webp", 0.88),
      );
      const entry = `pages/${pageId}.webp`;
      files[entry] = new Uint8Array(await blob.arrayBuffer());

      manifestPages.push({ id: pageId, image: entry, size: [width, height], panels: outPanels });
      pages.release(index);
    }
  } finally {
    await detector.release();
  }

  report({ kind: "packing" });
  files["manifest.json"] = new TextEncoder().encode(
    JSON.stringify({
      version: 1,
      readingDirection: "rtl",
      generator: "mangaji-web/0.1",
      pages: manifestPages,
    }),
  );

  // Sin comprimir: el arte ya es WebP y los sprites PNG, comprimir de nuevo no gana nada.
  const zipped = zipSync(files, { level: 0 });
  report({
    kind: "done",
    panels: totalPanels,
    balloons: totalBalloons,
    ms: performance.now() - started,
  });
  return new Blob([zipped as unknown as BlobPart], { type: "application/zip" });
}

const insideBox = (outer: Detection["bbox"], inner: Detection["bbox"]) => {
  const ix = Math.max(0, Math.min(outer.x + outer.w, inner.x + inner.w) - Math.max(outer.x, inner.x));
  const iy = Math.max(0, Math.min(outer.y + outer.h, inner.y + inner.h) - Math.max(outer.y, inner.y));
  return inner.w * inner.h > 0 ? (ix * iy) / (inner.w * inner.h) : 0;
};

/**
 * Junta en un solo sprite los bloques de un mismo globo, que el modelo parte por párrafo.
 *
 * Para el lector es un solo diálogo y se revela entero de una vez, así que se componen sobre
 * un lienzo del tamaño de la unión y se guarda un único PNG.
 */
async function mergeSprites(
  parts: Sprite[],
): Promise<{ bytes: Uint8Array; rect: Sprite["rect"]; ink: number } | null> {
  if (!parts.length) return null;

  const x0 = Math.min(...parts.map((p) => p.rect.x));
  const y0 = Math.min(...parts.map((p) => p.rect.y));
  const x1 = Math.max(...parts.map((p) => p.rect.x + p.rect.w));
  const y1 = Math.max(...parts.map((p) => p.rect.y + p.rect.h));
  const rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };

  const canvas = new OffscreenCanvas(rect.w, rect.h);
  const ctx = canvas.getContext("2d")!;
  for (const part of parts) {
    // `putImageData` ignora la transparencia acumulada, así que cada bloque va por su
    // propio lienzo y se dibuja encima respetando el alfa.
    const piece = new OffscreenCanvas(part.rect.w, part.rect.h);
    piece.getContext("2d")!.putImageData(part.image, 0, 0);
    ctx.drawImage(piece, part.rect.x - x0, part.rect.y - y0);
  }

  const blob = await canvas.convertToBlob({ type: "image/png" });
  const weighted = parts.reduce((s, p) => s + p.ink * p.rect.w * p.rect.h, 0);
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    rect,
    ink: weighted / Math.max(rect.w * rect.h, 1),
  };
}

import { zipSync } from "fflate";
import type { Note } from "./notes";
import { choosePanels, dedupe, fillAroundTexts, fillOrphans, inkGrid, isFolio, ownersOf, tailTip } from "./panels";
// Solo el tipo: así quien únicamente empaqueta no se trae los modelos ni el runtime.
import type { Detector, Detection } from "./detector";
import { lift, type Sprite } from "./dialogue";
import { balloonTail } from "./tail";
import { jaggedness, smooth, tension, tilt } from "./look";
import { ENTER_MS, revealBeats } from "./beats";

/**
 * Hasta qué tamaño se prueba levantar el texto de un globo entero, como fracción de la
 * página. Más que el tope de un bloque de texto: la caja del globo incluye su aire.
 */
const BALLOON_TEXT_AREA = 0.12;
/** Desde qué confianza un texto grande se trata como texto y no como dibujo. */
const SURE_TEXT = 0.7;
import { readingOrder, type Box } from "./reading-order";
import { polygonArea, type Point } from "./vision";
import { CPU_2D } from "./canvas";

/**
 * Convierte un CBZ en un `.cbza`: detecta viñetas y diálogo, decide el orden de lectura y la
 * dirección de cada viñeta, y empaqueta todo con el arte.
 *
 * Es el mismo pipeline que corre en Python, con las mismas constantes y salvaguardas. Vive
 * en el navegador porque ahí es más rápido —con GPU, entre cuatro y siete veces— y porque el
 * archivo no tiene que salir de la máquina de quien lee.
 */

/** Desde qué confianza una viñeta del modelo dice que la página es historieta. */
const SURE_PANEL = 0.5;
/** Cuántas páginas del principio del tomo pueden ser tapa, solapa, créditos o índice. */
const FRONT_MATTER = 8;
/** En una página entera, cuántos textos sueltos puede haber para que sean gritos, y con qué seguridad. */
const LOOSE_SHOUT = { max: 2, conf: 0.45 };
/** En una página entera, el texto en globo con al menos esta seguridad (un renglón del índice no). */
const BOXED_TEXT_CONF = 0.6;
/** En una página entera, solo los globos que el modelo ve con esta seguridad. */
const SURE_BALLOON = 0.6;

/** Descarta fragmentos espurios: una viñeta real nunca es tan chica. */
const MIN_PANEL_AREA = 0.02;

/**
 * Una página ya procesada, lista para leerse.
 *
 * Se emite apenas termina en vez de esperar al tomo entero: el arte y los sprites van
 * derecho al lector, y las mismas piezas se guardan para armar el `.cbza` al final.
 */
export type ProcessedPage = {
  index: number;
  id: string;
  size: [number, number];
  /** La entrada de esta página en el manifest. */
  page: Record<string, unknown>;
  /** El arte sin el diálogo, en WebP. */
  image: Uint8Array;
  sprites: Record<string, Uint8Array>;
  panels: number;
  balloons: number;
  /** Solo en desarrollo: lo que vio el modelo, para revisar el procesamiento. */
  debug?: unknown;
};

export type PageReporter = (note: Note) => void;



/** Cuánta tinta y qué tan alineados están los trazos: de ahí salen la cámara y el efecto. */
function measure(ctx: OffscreenCanvasRenderingContext2D, polygon: Point[], pageArea: number) {
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
 * Procesa una página y devuelve todo lo que hace falta para leerla.
 *
 * Trabaja sobre lienzos fuera de pantalla y no toca el DOM a propósito: así corre en un
 * worker, que es lo que permite leer las páginas ya listas mientras el resto se procesa
 * sin que la lectura vaya a tirones.
 */
export async function processPage(
  detector: Detector,
  bitmap: ImageBitmap,
  index: number,
  report?: PageReporter,
): Promise<ProcessedPage> {
  const sprites: Record<string, Uint8Array> = {};
  let totalBalloons = 0;

  const pageId = `p${String(index + 1).padStart(3, "0")}`;
  const width = bitmap.width;
  const height = bitmap.height;
  const pageArea = width * height;

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);

  report?.({ key: "findingPanels" });
  const pixels = ctx.getImageData(0, 0, width, height);
  const dets = await detector.detect(pixels);

  let panels = choosePanels(
    dets.filter((d) => d.cls === "frame" && polygonArea(d.polygon) / pageArea >= MIN_PANEL_AREA),
    pageArea,
  );
  // Sin ninguna viñeta segura no es una página de historieta: una tapa, un índice, un título de
  // capítulo, una ilustración, una página en blanco. Se muestra entera, sin recorrido, y solo
  // se levanta el texto que está en un globo: el título, el autor o el índice quedan impresos.
  const wholePage = !dets.some(
    (d) => d.cls === "frame" && d.conf >= SURE_PANEL && polygonArea(d.polygon) / pageArea >= MIN_PANEL_AREA,
  );
  if (wholePage) panels = [];
  // Lo que el modelo no vio: zonas grandes con dibujo que no son de ninguna viñeta.
  else panels.push(...fillOrphans(panels, dets.filter((d) => d.cls === "frame"), inkGrid(pixels.data, width, height)));
  const balloons = dedupe(dets.filter((d) => d.cls === "balloon" && (!wholePage || d.conf >= SURE_BALLOON)));
  // En una página entera: el texto en globo sí (un recuadro de narración, un diálogo sobre
  // una ilustración); el suelto, solo si es uno o dos gritos y la página no está entre las
  // primeras del tomo. Una tapa, un índice o un título traen varios textos sueltos —título,
  // autor, número de tomo, la lista de capítulos— que tienen que quedar impresos.
  const loose = dets.filter((d) => d.cls === "text" && d.free && d.conf >= LOOSE_SHOUT.conf);
  const shouts = !wholePage || (index >= FRONT_MATTER && loose.length <= LOOSE_SHOUT.max);
  const texts = dets.filter(
    (d) =>
      d.cls === "text" &&
      (!wholePage ||
        (d.free ? shouts && d.conf >= LOOSE_SHOUT.conf : d.conf >= BOXED_TEXT_CONF) ||
        balloons.some((b) => insideBox(b.bbox, d.bbox) >= 0.5)),
  );

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

  // Y lo que ni eso: una viñeta casi blanca con un texto, que queda suelto. El folio no.
  if (!wholePage) panels.push(
    ...fillAroundTexts(
      panels,
      [...texts, ...balloons].map((d) => d.bbox).filter((b) => !isFolio(b, panels, width, height)),
      width,
      height,
    ),
  );

  if (report) {
    // Lo encontrado, ya en orden de lectura, para que la pantalla de carga lo muestre.
    const order = readingOrder(
      panels.map((p) => p.bbox as Box),
      { polygons: panels.map((p) => p.polygon) },
    );
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    report({
      key: "liftingDialogue",
      n: panels.length,
      shapes: {
        panels: order.map((i) => panels[i].polygon.map(([x, y]) => [r3(x / width), r3(y / height)] as [number, number])),
        texts: [...texts, ...balloons]
          .filter((d) => !isFolio(d.bbox, panels, width, height))
          .map((d) => [r3(d.bbox.x / width), r3(d.bbox.y / height), r3(d.bbox.w / width), r3(d.bbox.h / height)]),
      },
    });
  }

  // Se levanta todo el texto de la página antes de repartirlo: hacerlo por viñeta deja
  // sin levantar los globos que quedan a caballo de un borde diagonal.
  const lifted: { det: Detection; sprite: Sprite }[] = [];
  const shapes = balloons.map((b) => b.polygon);
  for (const text of texts) {
    if (isFolio(text.bbox, panels, width, height)) continue;
    // Un texto que el modelo ve con mucha seguridad puede ser grande —un grito que ocupa
    // media viñeta—: se le permite el mismo tamaño que a un globo entero.
    // Lo mismo un grito suelto en una ilustración a página entera, que ya pasó el filtro de arriba.
    // Letra clara sobre negro no: ahí "la letra" no se separa bien de las llamas o las líneas
    // blancas de alrededor, y se borraban en bloque.
    const big = !text.light && (text.conf >= SURE_TEXT || (wholePage && text.free));
    const sprite = await lift(ctx, text, pageArea, shapes, big ? BALLOON_TEXT_AREA : undefined);
    if (sprite) lifted.push({ det: text, sprite });
  }

  // Un globo sin texto detectado adentro casi siempre tiene texto que el modelo no vio: dos
  // globos encimados, o un texto con poca confianza. Se prueba con la caja del globo; los
  // filtros de `lift` —fondo de papel, tinta repartida en letras— descartan los que no.
  for (const balloon of balloons) {
    if (lifted.some((l) => insideBox(balloon.bbox, l.det.bbox) >= 0.5)) continue;
    const text: Detection = { ...balloon, cls: "text" };
    const sprite = await lift(ctx, text, pageArea, shapes, BALLOON_TEXT_AREA);
    if (sprite) lifted.push({ det: text, sprite });
  }

  // Los bloques se agrupan por globo: el modelo parte un diálogo largo en varios.
  const taken = new Set<number>();
  const groups: {
    box: Detection["bbox"];
    parts: Sprite[];
    focus?: [number, number];
    tail?: [number, number];
    /** La silueta del globo, si lo hay: su forma dice si se grita o se habla. */
    shape?: Point[];
  }[] = [];
  // La colita se busca en la página original: el levantado ya borró el texto, pero el
  // contorno y el papel siguen igual, y así no depende del orden.
  const tailOf = (polygon: [number, number][]) => balloonTail(pixels.data, width, height, polygon) ?? undefined;
  for (const balloon of balloons) {
    const mine = lifted
      .map((l, i) => ({ ...l, i }))
      .filter(({ i, det }) => !taken.has(i) && insideBox(balloon.bbox, det.bbox) >= 0.5);
    if (mine.length) {
      mine.forEach(({ i }) => taken.add(i));
      // Hacia dónde mira el globo, para decidir si queda partido entre dos viñetas: el centro
      // de su texto. La colita sería lo natural, pero el modelo suele dejarla fuera de la
      // silueta del globo.
      const x0 = Math.min(...mine.map((m) => m.det.bbox.x));
      const y0 = Math.min(...mine.map((m) => m.det.bbox.y));
      const x1 = Math.max(...mine.map((m) => m.det.bbox.x + m.det.bbox.w));
      const y1 = Math.max(...mine.map((m) => m.det.bbox.y + m.det.bbox.h));
      groups.push({
        box: balloon.bbox,
        parts: mine.map((m) => m.sprite),
        focus: [(x0 + x1) / 2, (y0 + y1) / 2],
        tail: tailOf(balloon.polygon as [number, number][]),
        shape: balloon.polygon as Point[],
      });
    }
  }
  lifted.forEach((l, i) => {
    if (!taken.has(i)) groups.push({ box: l.det.bbox, parts: [l.sprite] });
  });
  for (const balloon of balloons) {
    if (!groups.some((g) => insideBox(balloon.bbox, g.box) > 0.5)) {
      groups.push({
        box: balloon.bbox,
        parts: [],
        focus: tailTip(balloon.polygon as [number, number][]) ?? undefined,
        tail: tailOf(balloon.polygon as [number, number][]),
        shape: balloon.polygon as Point[],
      });
    }
  }

  // Cada grupo va a la viñeta que lo contiene; ver `ownersOf`.
  const perPanel = new Map<number, { id: string; box: Detection["bbox"]; parts: Sprite[]; shape?: Point[] }[]>();
  groups.forEach((group, gi) => {
    const id = `${pageId}.b${gi}`;
    for (const owner of ownersOf(group.box, panels, group.focus, group.tail)) {
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
        sprites[sprite] = merged.bytes;
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
    const jagged = Math.max(1, ...mine.map((m) => (m.shape ? jaggedness(m.shape) : 1)));
    const rawTension = tension({ ink: look.ink, jagged, tilt: tilt(panel.polygon as Point[]) });
    const withSprite = outBalloons.filter((b) => b.sprite);
    const beats: Record<string, unknown>[] = [{ t: 0, ms: ENTER_MS, cam: camera(look) }];
    const fx = effect(look);
    if (fx) beats.push({ t: Math.max(ENTER_MS - 80, 0), ms: 420, fx });

    beats.push(...revealBeats(withSprite));

    return {
      id: `${pageId}.k${position}`,
      order: position,
      polygon: panel.polygon.map(([x, y]) => [Math.round(x), Math.round(y)]),
      bbox: [panel.bbox.x, panel.bbox.y, panel.bbox.w, panel.bbox.h].map((v) => Math.round(v)),
      confidence: Number(panel.conf.toFixed(3)),
      balloons: outBalloons,
      beats,
      look: { tension: rawTension },
    };
  });
  // La tensión se suaviza con las vecinas en orden de lectura: una escena cambia de a poco.
  smooth(outPanels.map((p) => p.look.tension)).forEach((v, i) => {
    outPanels[i].look.tension = Number(v.toFixed(3));
  });

  // El arte se guarda ya sin el diálogo, así que hay que recodificarlo.
  const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.88 });
  const entry = `pages/${pageId}.webp`;

  return {
    index,
    id: pageId,
    size: [width, height],
    page: { id: pageId, image: entry, size: [width, height], panels: outPanels },
    image: new Uint8Array(await blob.arrayBuffer()),
    sprites,
    panels: outPanels.length,
    balloons: totalBalloons,
    debug:
      process.env.NODE_ENV !== "production"
        ? {
            dets: dets.map((d) => ({ cls: d.cls, conf: +d.conf.toFixed(3), bbox: [d.bbox.x, d.bbox.y, d.bbox.w, d.bbox.h].map(Math.round) })),
            panels: panels.map((p) => ({ conf: +p.conf.toFixed(3), bbox: [p.bbox.x, p.bbox.y, p.bbox.w, p.bbox.h].map(Math.round), polygon: p.polygon })),
          }
        : undefined,
  };
}

/**
 * Arma el `.cbza` con las páginas ya procesadas.
 *
 * Se hace al final, cuando ya no interrumpe a nadie: para ese momento la lectura viene
 * corriendo desde hace rato sobre estas mismas piezas.
 */
function manifestBytes(pages: ProcessedPage[]): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      version: 1,
      readingDirection: "rtl",
      generator: "mangaji-web/0.1",
      pages: pages.map((p) => p.page),
    }),
  );
}

export function packArchive(pages: ProcessedPage[]): Blob {
  const files: Record<string, Uint8Array> = {};
  for (const page of pages) {
    files[`pages/${page.id}.webp`] = page.image;
    Object.assign(files, page.sprites);
  }

  files["manifest.json"] = manifestBytes(pages);

  // Sin comprimir: el arte ya es WebP y los sprites PNG, comprimir de nuevo no gana nada.
  const zipped = zipSync(files, { level: 0 });
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
  const ctx = canvas.getContext("2d", CPU_2D)!;
  for (const part of parts) {
    // `putImageData` ignora la transparencia acumulada, así que cada bloque va por su
    // propio lienzo y se dibuja encima respetando el alfa.
    const piece = new OffscreenCanvas(part.rect.w, part.rect.h);
    piece.getContext("2d", CPU_2D)!.putImageData(part.image, 0, 0);
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

import type { Detection } from "./detector";
import { insidePolygon } from "./dialogue";

/**
 * Qué detecciones de viñeta se quedan.
 *
 * El detector devuelve candidatas con su confianza. Las seguras pasan; las dudosas no, salvo
 * un caso: una candidata grande en una zona que ninguna viñeta segura reclama. Es lo que
 * pasa con las viñetas que llegan al borde de la hoja sin marco dibujado —arriba de todo, o
 * a sangre—: el modelo las ve, pero con poca confianza. Si esa zona queda sin viñeta, la
 * lectura se la saltea o la lee fuera de orden.
 *
 * Medido sobre un tomo entero (198 páginas): el rescate agregó una viñeta en 17, y las 17
 * eran viñetas reales.
 */

/** A partir de acá una viñeta es segura. */
export const PANEL_CONF = 0.25;
/** Piso para considerar una candidata dudosa. Por debajo, es ruido. */
export const RESCUE_CONF = 0.08;
/** Una candidata dudosa tiene que ser grande: una viñeta que se escapa, no un recorte. */
const RESCUE_MIN_AREA = 0.1;
/** Y casi no pisar lo que ya está: si otra viñeta cubre esa zona, no hace falta. */
const RESCUE_MAX_OVERLAP = 0.2;
/** Dos detecciones que se solapan más que esto son la misma, vista dos veces. */
const DEDUPE_IOU = 0.6;

type Box = Detection["bbox"];

const intersection = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

const iou = (a: Box, b: Box) => {
  const inter = intersection(a, b);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
};

/** Se queda con la detección más confiable de cada grupo solapado. */
export function dedupe(dets: Detection[]): Detection[] {
  const kept: Detection[] = [];
  for (const det of [...dets].sort((a, b) => b.conf - a.conf)) {
    if (kept.every((k) => iou(det.bbox, k.bbox) < DEDUPE_IOU)) kept.push(det);
  }
  return kept;
}

/**
 * Las viñetas de la página: las seguras, más las dudosas que cubren una zona huérfana.
 *
 * `frames` ya viene filtrado por tamaño mínimo; acá se decide por confianza y cobertura.
 */
export function choosePanels(frames: Detection[], pageArea: number): Detection[] {
  const panels = dedupe(frames.filter((d) => d.conf >= PANEL_CONF));

  const doubtful = frames
    .filter((d) => d.conf >= RESCUE_CONF && d.conf < PANEL_CONF)
    .sort((a, b) => b.conf - a.conf);
  for (const det of doubtful) {
    const area = det.bbox.w * det.bbox.h;
    if (area / pageArea < RESCUE_MIN_AREA) continue;
    const covered = panels.reduce((sum, p) => sum + intersection(det.bbox, p.bbox), 0) / area;
    if (covered < RESCUE_MAX_OVERLAP) panels.push(det);
  }
  return panels;
}

/** Piso de confianza para que una candidata pueda prestarle su forma a una zona huérfana. */
export const SHAPE_CONF = 0.02;
/** Columnas de la grilla con la que se buscan zonas huérfanas. */
const GRID_COLS = 60;
/** Una celda con al menos esta fracción de píxeles oscuros tiene dibujo. */
const INK_CELL = 0.04;
/** Una zona huérfana tiene que ser grande, compacta y no pisar viñetas. */
const ORPHAN = { minArea: 0.06, minSide: 0.12, minFill: 0.6, maxCovered: 0.2, inside: 0.8 };

/** Qué celdas de la grilla tienen dibujo: fracción de píxeles oscuros por celda. */
export type InkGrid = { cols: number; rows: number; cellW: number; cellH: number; ink: Float32Array };

/** Mide la tinta de la página en una grilla gruesa, una sola pasada por los píxeles. */
export function inkGrid(data: Uint8ClampedArray, width: number, height: number): InkGrid {
  const cols = GRID_COLS;
  const cellW = width / cols;
  const rows = Math.max(1, Math.round(height / cellW));
  const cellH = height / rows;
  const dark = new Float32Array(cols * rows);
  const total = new Float32Array(cols * rows);
  for (let y = 0; y < height; y++) {
    const row = Math.min(rows - 1, Math.floor(y / cellH)) * cols;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const c = row + Math.min(cols - 1, Math.floor(x / cellW));
      total[c]++;
      if (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114 < 110) dark[c]++;
    }
  }
  for (let c = 0; c < dark.length; c++) dark[c] = total[c] ? dark[c] / total[c] : 0;
  return { cols, rows, cellW, cellH, ink: dark };
}

function insidePoly(px: number, py: number, poly: [number, number][]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Erosión o dilatación 3×3 sobre la grilla, con el borde como vacío. */
function morph(src: Uint8Array, cols: number, rows: number, erode: boolean): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let hit = erode;
      for (let dy = -1; dy <= 1 && hit === erode; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          const v = xx >= 0 && yy >= 0 && xx < cols && yy < rows ? src[yy * cols + xx] : 0;
          if (erode ? !v : v) {
            hit = !erode;
            break;
          }
        }
      }
      out[y * cols + x] = hit ? 1 : 0;
    }
  }
  return out;
}

/**
 * Viñetas que el modelo no ve.
 *
 * Hay viñetas —grandes, a sangre, sin marco dibujado— que el modelo propone con 4 % de
 * confianza o ni siquiera propone, aunque para una persona sean obvias. Esta es la red de
 * seguridad: una zona grande con dibujo que no pertenece a ninguna viñeta es una viñeta.
 *
 * Las calles entre viñetas, blancas o negras, son franjas finas y se borran antes de
 * agrupar; los márgenes no tienen tinta; los globos sueltos son chicos. Si el modelo
 * propuso algo que contiene la zona, aunque sea con confianza bajísima, se usa su forma:
 * sigue mejor el borde que un rectángulo, y no parte en dos una viñeta con cielo vacío.
 */
export function fillOrphans(panels: Detection[], frames: Detection[], grid: InkGrid): Detection[] {
  if (!panels.length) return [];
  const { cols, rows, cellW, cellH, ink } = grid;

  const covered = new Uint8Array(cols * rows);
  const free = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const c = y * cols + x;
      const px = (x + 0.5) * cellW;
      const py = (y + 0.5) * cellH;
      covered[c] = panels.some((p) => insidePoly(px, py, p.polygon as [number, number][])) ? 1 : 0;
      free[c] = !covered[c] && ink[c] >= INK_CELL ? 1 : 0;
    }
  }
  const opened = morph(morph(free, cols, rows, true), cols, rows, false);
  for (let c = 0; c < free.length; c++) opened[c] &= free[c];

  // Zonas conexas (vecindad de 4), con su caja y su tamaño.
  const label = new Int32Array(cols * rows).fill(-1);
  const zones: { x0: number; y0: number; x1: number; y1: number; n: number }[] = [];
  for (let start = 0; start < opened.length; start++) {
    if (!opened[start] || label[start] >= 0) continue;
    const zone = { x0: cols, y0: rows, x1: 0, y1: 0, n: 0 };
    const stack = [start];
    label[start] = zones.length;
    while (stack.length) {
      const c = stack.pop()!;
      const x = c % cols;
      const y = (c / cols) | 0;
      zone.n++;
      zone.x0 = Math.min(zone.x0, x);
      zone.y0 = Math.min(zone.y0, y);
      zone.x1 = Math.max(zone.x1, x);
      zone.y1 = Math.max(zone.y1, y);
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ]) {
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const n = ny * cols + nx;
        if (opened[n] && label[n] < 0) {
          label[n] = zones.length;
          stack.push(n);
        }
      }
    }
    zones.push(zone);
  }

  const added: Detection[] = [];
  const all = () => [...panels, ...added];
  for (const z of zones) {
    const w = z.x1 - z.x0 + 1;
    const h = z.y1 - z.y0 + 1;
    if (z.n / (cols * rows) < ORPHAN.minArea || w / cols < ORPHAN.minSide || h / rows < ORPHAN.minSide) continue;
    if (z.n / (w * h) < ORPHAN.minFill) continue;
    let under = 0;
    for (let y = z.y0; y <= z.y1; y++) for (let x = z.x0; x <= z.x1; x++) under += covered[y * cols + x];
    if (under / (w * h) >= ORPHAN.maxCovered) continue;

    const box = { x: z.x0 * cellW, y: z.y0 * cellH, w: w * cellW, h: h * cellH };
    const area = box.w * box.h;
    if (added.some((a) => intersection(box, a.bbox) / area >= ORPHAN.inside)) continue;

    const shape = frames
      .filter(
        (f) =>
          f.conf >= SHAPE_CONF &&
          !panels.includes(f) &&
          intersection(box, f.bbox) / area >= ORPHAN.inside &&
          all().reduce((s, p) => s + intersection(f.bbox, p.bbox), 0) / (f.bbox.w * f.bbox.h) < ORPHAN.maxCovered,
      )
      .sort((a, b) => b.conf - a.conf)[0];

    added.push(
      shape ?? {
        cls: "frame",
        conf: 0,
        bbox: box,
        polygon: [
          [box.x, box.y],
          [box.x + box.w, box.y],
          [box.x + box.w, box.y + box.h],
          [box.x, box.y + box.h],
        ],
      },
    );
  }
  return added;
}

/** Con esta fracción dentro de una viñeta, el globo también le pertenece. */
const SHARED_BALLOON = 0.25;
/** Con esto dentro de una viñeta, el globo es entero suyo y no se comparte. */
const WHOLE_SHARE = 0.75;
/** Con menos que esto dentro de toda silueta, la silueta no alcanza para decidir. */
const CLEAR_SHARE = 0.5;

/**
 * A qué viñetas pertenece un globo o un texto.
 *
 * Se mide contra la silueta: con bordes diagonales las cajas de dos vecinas se pisan y el
 * globo cae en la de al lado. Pero la silueta del modelo a veces cubre solo el dibujo y deja
 * afuera la parte blanca de la viñeta, justo donde va el texto. Sin ninguna silueta que lo
 * contenga, el texto iba a parar a la primera viñeta de la lista —otra, a veces en la otra
 * punta de la página— y aparecía mientras se leía esa. Entonces decide la caja de la viñeta,
 * y si tampoco lo toca ninguna, la más cercana.
 */
export function ownersOf(box: Box, panels: Detection[]): number[] {
  if (!panels.length) return [];
  const shares = panels.map((p) => insidePolygon(p.polygon, box));
  const top = Math.max(...shares);
  // Si una viñeta lo contiene casi entero, es de esa sola. Que otra también lo contenga no es
  // un globo partido sino dos viñetas encimadas —típicamente una rellenada a mano, que es un
  // rectángulo y se pasa sobre las vecinas—, y gana la más chica, que es la más precisa.
  // Compartirlo lo mostraba al leer la otra, que en una doble página se lee primero.
  const whole = shares.map((s, i) => (s >= WHOLE_SHARE ? i : -1)).filter((i) => i >= 0);
  if (whole.length) {
    const area = (i: number) => panels[i].bbox.w * panels[i].bbox.h;
    return [whole.reduce((a, b) => (area(b) < area(a) ? b : a))];
  }
  if (top >= CLEAR_SHARE) {
    return shares.map((s, i) => (s >= SHARED_BALLOON ? i : -1)).filter((i) => i >= 0);
  }

  const area = Math.max(box.w * box.h, 1);
  const overlaps = panels.map((p) => intersection(box, p.bbox) / area);
  const most = Math.max(...overlaps);
  if (most > 0) return [overlaps.indexOf(most)];

  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const gap = panels.map(({ bbox: b }) =>
    Math.hypot(Math.max(b.x - cx, 0, cx - (b.x + b.w)), Math.max(b.y - cy, 0, cy - (b.y + b.h))),
  );
  return [gap.indexOf(Math.min(...gap))];
}

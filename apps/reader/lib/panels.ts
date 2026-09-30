import type { Detection } from "./detector";
import { insidePolygon } from "./dialogue";
import { open, type Point } from "./vision";

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
const ORPHAN = { minArea: 0.06, minSide: 0.12, minFill: 0.6, maxCovered: 0.2, inside: 0.8, mostly: 0.6, maxCoveredLoose: 0.1 };

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
  const overlapShare = (f: Detection) =>
    all().reduce((sum, p) => sum + intersection(f.bbox, p.bbox), 0) / (f.bbox.w * f.bbox.h);
  for (const z of zones) {
    const w = z.x1 - z.x0 + 1;
    const h = z.y1 - z.y0 + 1;
    if (z.n / (cols * rows) < ORPHAN.minArea || w / cols < ORPHAN.minSide || h / rows < ORPHAN.minSide) continue;
    if (z.n / (w * h) < ORPHAN.minFill) continue;
    // Cuánto pisa a las viñetas ya detectadas se mide después de recortarla contra ellas: la
    // caja sale de una grilla gruesa y se mete sobre la vecina de al lado, y sin recortar una
    // viñeta alta junto a una columna de viñetas quedaba descartada por eso.
    const box = { x: z.x0 * cellW, y: z.y0 * cellH, w: w * cellW, h: h * cellH };
    const trimmed = clear(box, panels);
    const cx0 = Math.max(0, Math.floor(trimmed.x / cellW));
    const cy0 = Math.max(0, Math.floor(trimmed.y / cellH));
    const cx1 = Math.min(cols - 1, Math.ceil((trimmed.x + trimmed.w) / cellW) - 1);
    const cy1 = Math.min(rows - 1, Math.ceil((trimmed.y + trimmed.h) / cellH) - 1);
    let under = 0;
    for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) under += covered[y * cols + x];
    if (under / Math.max(1, (cx1 - cx0 + 1) * (cy1 - cy0 + 1)) >= ORPHAN.maxCovered) continue;

    const area = box.w * box.h;
    if (added.some((a) => intersection(box, a.bbox) / area >= ORPHAN.inside)) continue;

    const shape = frames
      .filter(
        (f) =>
          f.conf >= SHAPE_CONF &&
          !panels.includes(f) &&
          // El candidato contiene la zona, o cae dentro de ella y cubre la mayor parte: en
          // el segundo caso la zona abarcaba además otra viñeta que el modelo no ve, y el
          // candidato marca dónde termina esta.
          // En ese caso además tiene que respetar a las vecinas: un candidato flojo que se mete
          // sobre ellas les roba los globos.
          (intersection(box, f.bbox) / area >= ORPHAN.inside
            ? overlapShare(f) < ORPHAN.maxCovered
            : intersection(box, f.bbox) / (f.bbox.w * f.bbox.h) >= ORPHAN.inside &&
              intersection(box, f.bbox) / area >= ORPHAN.mostly &&
              overlapShare(f) < ORPHAN.maxCoveredLoose),
      )
      .sort((a, b) => b.conf - a.conf)[0];

    const rect = shape ? box : trimmed;
    added.push(
      shape ?? {
        cls: "frame",
        conf: 0,
        bbox: rect,
        polygon: [
          [rect.x, rect.y],
          [rect.x + rect.w, rect.y],
          [rect.x + rect.w, rect.y + rect.h],
          [rect.x, rect.y + rect.h],
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
export function ownersOf(box: Box, panels: Detection[], tail?: Point): number[] {
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
    const owners = shares.map((s, i) => (s >= SHARED_BALLOON ? i : -1)).filter((i) => i >= 0);
    // Una viñeta de relleno —un rectángulo, o un candidato que el modelo apenas vio— no
    // comparte el globo con una detectada: su borde es aproximado y el globo es de la otra.
    const detected = owners.filter((i) => panels[i].conf >= RESCUE_CONF);
    const shared = detected.length ? detected : owners;
    // Un globo partido entre dos viñetas es de la que señala su colita: quien habla está
    // ahí. Compartirlo lo mostraba al leer la otra, que muchas veces va antes.
    if (shared.length > 1 && tail) {
      const pointed = shared.filter((i) => containsPoint(panels[i].polygon as Point[], tail));
      if (pointed.length === 1) return pointed;
    }
    return shared;
  }

  // Por caja, también ganan las detectadas: la caja de un relleno es aproximada.
  const area = Math.max(box.w * box.h, 1);
  const overlaps = panels.map((p) => intersection(box, p.bbox) / area);
  const pick = (candidates: number[]) => {
    const best = candidates.reduce((a, b) => (overlaps[b] > overlaps[a] ? b : a), candidates[0]);
    return overlaps[best] > 0 ? best : -1;
  };
  const indices = panels.map((_, i) => i);
  const fromDetected = pick(indices.filter((i) => panels[i].conf >= RESCUE_CONF));
  if (fromDetected >= 0) return [fromDetected];
  const fromAny = pick(indices);
  if (fromAny >= 0) return [fromAny];

  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const gap = panels.map(({ bbox: b }) =>
    Math.hypot(Math.max(b.x - cx, 0, cx - (b.x + b.w)), Math.max(b.y - cy, 0, cy - (b.y + b.h))),
  );
  return [gap.indexOf(Math.min(...gap))];
}

/**
 * Achica el rectángulo de una zona huérfana para que no pise las viñetas vecinas.
 *
 * La zona sale de una grilla gruesa y su caja se pasa sobre las vecinas: en una columna de
 * viñetas junto a una grande, la de relleno se metía cien píxeles sobre la columna, y los
 * globos de esas viñetas quedaban compartidos con ella y aparecían al leerla. Se recorta del
 * lado por donde entra cada vecina, si con eso no pierde más de la mitad.
 */
function clear(box: Box, panels: Detection[]): Box {
  let { x, y, w, h } = box;
  for (const { bbox: p } of panels) {
    const ox = Math.min(x + w, p.x + p.w) - Math.max(x, p.x);
    const oy = Math.min(y + h, p.y + p.h) - Math.max(y, p.y);
    if (ox <= 0 || oy <= 0) continue;
    let next: Box;
    if (ox < oy) {
      // La vecina entra por un costado.
      next = p.x + p.w / 2 < x + w / 2 ? { x: p.x + p.w, y, w: x + w - (p.x + p.w), h } : { x, y, w: p.x - x, h };
    } else {
      next = p.y + p.h / 2 < y + h / 2 ? { x, y: p.y + p.h, w, h: y + h - (p.y + p.h) } : { x, y, w, h: p.y - y };
    }
    if (next.w > 0 && next.h > 0 && next.w * next.h >= (box.w * box.h) / 2) ({ x, y, w, h } = next);
  }
  return { x, y, w, h };
}

/** Franja de arriba y de abajo de la hoja donde va el folio, como fracción del alto. */
const FOLIO_BAND = 0.08;
/** Alto máximo del folio, como fracción del alto de la hoja: una línea. */
const FOLIO_HEIGHT = 0.04;

/**
 * ¿Es el folio —"057 Saint Seiya volume 1"— y no un diálogo?
 *
 * Para el modelo es texto, y lo es, pero no le habla nadie: va en el margen, fuera de las
 * viñetas, pegado al borde de arriba o de abajo, y en una sola línea.
 */
export function isFolio(box: Box, panels: Detection[], width: number, height: number): boolean {
  if (box.h > FOLIO_HEIGHT * height) return false;
  const top = box.y + box.h <= FOLIO_BAND * height;
  const bottom = box.y >= (1 - FOLIO_BAND) * height;
  if (!top && !bottom) return false;
  const area = Math.max(box.w * box.h, 1);
  return panels.every((p) => intersection(box, p.bbox) / area < 0.2);
}

/** Tamaño mínimo de la viñeta que se arma alrededor de un texto suelto: fracción de la hoja. */
const LONE_MIN_AREA = 0.04;

/**
 * Viñetas alrededor de textos que no caen en ninguna.
 *
 * Una viñeta casi toda blanca —una cara y un globo— no la ve el modelo ni se rellena por
 * tinta, y su texto iba a parar a la viñeta más cercana: aparecía fuera de lugar y la cámara
 * no lo encuadraba. Si hay un texto suelto, el hueco que lo rodea —entre las viñetas vecinas
 * y el borde de la hoja— es su viñeta.
 */
export function fillAroundTexts(panels: Detection[], boxes: Box[], width: number, height: number): Detection[] {
  const added: Detection[] = [];
  for (const box of boxes) {
    const all = [...panels, ...added];
    const area = Math.max(box.w * box.h, 1);
    if (all.some((p) => intersection(box, p.bbox) / area >= 0.2)) continue;

    // Primero arriba y abajo, con las viñetas que comparten columna con el texto; después
    // a los costados, con las que comparten esa franja.
    const overlapsX = (b: Box, x0: number, x1: number) => b.x < x1 && b.x + b.w > x0;
    const overlapsY = (b: Box, y0: number, y1: number) => b.y < y1 && b.y + b.h > y0;
    let y0 = 0;
    let y1 = height;
    for (const { bbox: b } of all) {
      if (!overlapsX(b, box.x, box.x + box.w)) continue;
      if (b.y + b.h <= box.y) y0 = Math.max(y0, b.y + b.h);
      if (b.y >= box.y + box.h) y1 = Math.min(y1, b.y);
    }
    let x0 = 0;
    let x1 = width;
    for (const { bbox: b } of all) {
      if (!overlapsY(b, y0, y1)) continue;
      if (b.x + b.w <= box.x) x0 = Math.max(x0, b.x + b.w);
      if (b.x >= box.x + box.w) x1 = Math.min(x1, b.x);
    }
    const rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    if (rect.w * rect.h < LONE_MIN_AREA * width * height) continue;
    added.push({
      cls: "frame",
      conf: 0,
      bbox: rect,
      polygon: [
        [rect.x, rect.y],
        [rect.x + rect.w, rect.y],
        [rect.x + rect.w, rect.y + rect.h],
        [rect.x, rect.y + rect.h],
      ],
    });
  }
  return added;
}

/** Punto en polígono por cruce de rayos. */
function containsPoint(polygon: Point[], [px, py]: Point): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Radio del cuadrado con que se "plancha" el globo, como fracción de su lado menor. */
const TAIL_OPEN = 0.15;

/**
 * La punta de la colita de un globo, si tiene.
 *
 * Se abre la silueta con un cuadrado: el cuerpo del globo sobrevive y lo angosto se va. Lo
 * que se fue y más se aleja del cuerpo es la colita, y su extremo, hacia dónde señala. Un
 * cuadrado y no un disco porque entra entero en una esquina: un globo recortado por el
 * borde de la viñeta no pierde sus esquinas, que si no pasaban por colitas.
 */
export function tailTip(polygon: Point[]): Point | null {
  if (polygon.length < 3) return null;
  const xs = polygon.map((p) => p[0]);
  const ys = polygon.map((p) => p[1]);
  const x0 = Math.floor(Math.min(...xs)) - 2;
  const y0 = Math.floor(Math.min(...ys)) - 2;
  const w = Math.ceil(Math.max(...xs)) - x0 + 3;
  const h = Math.ceil(Math.max(...ys)) - y0 + 3;
  if (w < 8 || h < 8 || w * h > 4_000_000) return null;

  const mask = new Uint8Array(w * h);
  // Relleno por filas: los cruces de cada fila con los lados, de a pares.
  for (let y = 0; y < h; y++) {
    const cy = y + y0 + 0.5;
    const cuts: number[] = [];
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i];
      const [xj, yj] = polygon[j];
      if (yi > cy !== yj > cy) cuts.push(((xj - xi) * (cy - yi)) / (yj - yi) + xi - x0);
    }
    cuts.sort((a, b) => a - b);
    for (let k = 0; k + 1 < cuts.length; k += 2) {
      for (let x = Math.max(0, Math.ceil(cuts[k] - 0.5)); x < Math.min(w, cuts[k + 1] - 0.5); x++) mask[y * w + x] = 1;
    }
  }

  const r = Math.max(2, Math.round(Math.min(w, h) * TAIL_OPEN));
  const body = open(mask, w, h, r);

  // Distancia al cuerpo, recorriendo solo lo que el cuerpo perdió.
  const dist = new Int32Array(w * h).fill(-1);
  const queue: number[] = [];
  for (let p = 0; p < w * h; p++) if (body[p]) (dist[p] = 0), queue.push(p);
  let far = -1;
  for (let head = 0; head < queue.length; head++) {
    const p = queue[head];
    const x = p % w;
    const y = (p / w) | 0;
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      if (!mask[n] || dist[n] >= 0) continue;
      dist[n] = dist[p] + 1;
      queue.push(n);
      if (far < 0 || dist[n] > dist[far]) far = n;
    }
  }
  if (far < 0) return null;
  return [(far % w) + x0, ((far / w) | 0) + y0];
}

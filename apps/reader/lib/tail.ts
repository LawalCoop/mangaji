import { dilate, erode, open, type Point } from "./vision";

/**
 * La colita de un globo, buscada en la página y no en la silueta del modelo.
 *
 * El modelo deja la colita afuera de la silueta, así que de ahí no se puede sacar. Pero en
 * la página está: el interior del globo es papel cerrado por el contorno, y la colita es
 * ese mismo papel que se estira por la abertura. Se rellena el papel desde adentro del
 * globo, frenando en la tinta, y lo que el relleno alcanza fuera de la silueta es la
 * colita; su punta, lo más alejado. Si el relleno se escapa —un globo sin contorno, o
 * abierto contra el borde de la viñeta—, no hay colita que leer.
 */

/** A partir de este brillo un píxel es papel. */
const PAPER = 190;
/** Cuánto se busca alrededor del globo, como fracción de su lado mayor. */
const REACH = 0.6;
/** Si lo rellenado afuera supera esta fracción del globo, el relleno se escapó. */
const MAX_SPILL = 0.5;
/** Cuánto se mete la siembra hacia adentro, como fracción del lado menor del globo. */
const CORE = 0.12;
/** Radio con que se plancha el globo para quedarse con el cuerpo, como fracción del lado menor. */
const BODY = 0.18;
/** La punta tiene que alejarse del cuerpo al menos esta fracción de ese radio. */
const MIN_LENGTH = 0.3;

export function balloonTail(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  polygon: Point[],
): Point | null {
  if (polygon.length < 3) return null;
  const xs = polygon.map((p) => p[0]);
  const ys = polygon.map((p) => p[1]);
  const bw = Math.max(...xs) - Math.min(...xs);
  const bh = Math.max(...ys) - Math.min(...ys);
  if (bw < 12 || bh < 12) return null;
  const pad = Math.round(Math.max(bw, bh) * REACH);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)) - pad);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)) - pad);
  const x1 = Math.min(width, Math.ceil(Math.max(...xs)) + pad);
  const y1 = Math.min(height, Math.ceil(Math.max(...ys)) + pad);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w * h > 6_000_000) return null;

  // Silueta del globo, rasterizada por filas.
  const inside = new Uint8Array(w * h);
  let area = 0;
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
      for (let x = Math.max(0, Math.ceil(cuts[k] - 0.5)); x < Math.min(w, cuts[k + 1] - 0.5); x++) {
        inside[y * w + x] = 1;
        area++;
      }
    }
  }
  if (!area) return null;

  const paper = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((y + y0) * width + x + x0) * 4;
      paper[y * w + x] = Math.max(data[i], data[i + 1], data[i + 2]) >= PAPER ? 1 : 0;
    }
  }

  // Se siembra desde bien adentro: la silueta del modelo se pasa a veces del contorno, y
  // sembrar en su borde arrancaba el relleno ya afuera del globo.
  const core = erode(inside, w, h, Math.max(2, Math.round(Math.min(bw, bh) * CORE)));
  const region = new Uint8Array(w * h);
  const queue: number[] = [];
  for (let p = 0; p < w * h; p++) {
    if (core[p] && paper[p]) {
      region[p] = 1;
      queue.push(p);
    }
  }
  if (!queue.length) return null;
  let spill = 0;
  for (let head = 0; head < queue.length; head++) {
    const p = queue[head];
    const x = p % w;
    const y = (p / w) | 0;
    for (const n of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
      if (n < 0 || region[n] || !paper[n]) continue;
      region[n] = 1;
      queue.push(n);
      if (!inside[n] && ++spill > area * MAX_SPILL) return null;
      const nx = n % w;
      const ny = (n / w) | 0;
      if (nx === 0 || ny === 0 || nx === w - 1 || ny === h - 1) return null;
    }
  }

  // Las letras dejan huecos en el relleno: se cierran, para que el cuerpo sea macizo.
  const solid = fillHoles(erode(dilate(region, w, h, 3), w, h, 3), w, h);

  // El cuerpo es lo que sobrevive a "planchar" lo angosto; la colita, lo que se aleja de él.
  const r = Math.max(3, Math.round(Math.min(bw, bh) * BODY));
  const body = open(solid, w, h, r);
  const dist = new Int32Array(w * h).fill(-1);
  const walk: number[] = [];
  for (let p = 0; p < w * h; p++) if (body[p]) (dist[p] = 0), walk.push(p);
  let far = -1;
  for (let head = 0; head < walk.length; head++) {
    const p = walk[head];
    const x = p % w;
    const y = (p / w) | 0;
    for (const n of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
      if (n < 0 || dist[n] >= 0 || !solid[n]) continue;
      dist[n] = dist[p] + 1;
      walk.push(n);
      if (far < 0 || dist[n] > dist[far]) far = n;
    }
  }
  if (far < 0 || dist[far] < r * MIN_LENGTH) return null;
  return [(far % w) + x0, ((far / w) | 0) + y0];
}

/** Rellena los huecos de una máscara: lo que no se alcanza desde el borde por el fondo. */
function fillHoles(mask: Uint8Array, w: number, h: number): Uint8Array {
  const outside = new Uint8Array(w * h);
  const queue: number[] = [];
  const seed = (p: number) => {
    if (!mask[p] && !outside[p]) {
      outside[p] = 1;
      queue.push(p);
    }
  };
  for (let x = 0; x < w; x++) seed(x), seed((h - 1) * w + x);
  for (let y = 0; y < h; y++) seed(y * w), seed(y * w + w - 1);
  for (let head = 0; head < queue.length; head++) {
    const p = queue[head];
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0) seed(p - 1);
    if (x < w - 1) seed(p + 1);
    if (y > 0) seed(p - w);
    if (y < h - 1) seed(p + w);
  }
  const out = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) out[p] = outside[p] ? 0 : 1;
  return out;
}

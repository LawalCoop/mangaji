import type { Rect } from "./types";
import { components, dilate } from "./vision";

/**
 * Texto con halo: letras negras con un borde blanco alrededor, flotando sobre trama, líneas
 * de velocidad o dibujo, sin globo. Es muy común en el manga ("¿QUÉ PIENSAS DE MIS
 * ATAQUES?" sobre una trama gris) y la extracción común lo descarta, porque debajo no hay
 * papel para tapar el hueco.
 *
 * Acá se reconocen las letras por el halo —una mancha oscura rodeada casi entera de blanco;
 * la trama y las líneas no lo tienen—, se recortan junto con su halo, y el hueco se rellena
 * copiando un pedazo vecino de lo que hay alrededor, elegido para que empalme sin costura.
 * Si no empalma bien, no se toca nada: mejor dejar el texto impreso que ensuciar el dibujo.
 */

/** Por debajo de este brillo, tinta; por encima de este, el blanco del halo. */
const DARK = 110;
const LIGHT = 215;
/** Qué parte del anillo que rodea una letra tiene que ser halo blanco. */
const HALO_SHARE = 0.6;
/** Ancho del anillo con que se mira el halo, y cuánto se agranda la letra para llevárselo. */
const RING = 2;
const HALO = 4;
/**
 * Alto de una letra de diálogo, como fracción del alto de la página. Las onomatopeyas de
 * Kingdom también tienen halo, pero son mucho más grandes.
 */
const LETTER_H = { min: 0.009, max: 0.04 };
/**
 * Cuántas letras hacen un texto, y qué parte del alto de la caja tienen que ocupar. No se mide
 * contra la tinta de la caja: la trama y las líneas de alrededor también son tinta.
 */
const MIN_LETTERS = 4;
const LETTER_SPAN = 0.5;
/** Hasta dónde se busca de dónde copiar el relleno, en píxeles. */
const REACH = 72;
/** Diferencia media tolerada en el borde del relleno, en niveles de gris (0..255). */
const MAX_SEAM = 48;

const lum = (px: Uint8ClampedArray, i: number) => px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;

export type HaloLift = {
  /** Lo que se lleva el sprite: alfa por píxel de la región (letras y halo). */
  alpha: Uint8Array;
  /** Los píxeles de la región con el hueco ya rellenado. */
  filled: Uint8ClampedArray;
  ink: number;
};

/**
 * Busca texto con halo en la región `px` (w×h) dentro de `seed`, y si lo hay devuelve qué
 * llevarse y con qué tapar. `pageH` es el alto de la página, para medir las letras.
 */
export function liftHalo(px: Uint8ClampedArray, w: number, h: number, seed: Rect, pageH: number): HaloLift | null {
  const n = w * h;
  const dark = new Uint8Array(n);
  const light = new Uint8Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const v = lum(px, i);
    if (v < DARK) dark[p] = 1;
    else if (v > LIGHT) light[p] = 1;
  }

  // Las letras: manchas oscuras de tamaño de letra, con halo blanco alrededor, dentro de la caja.
  const { labels, stats } = components(dark, w, h);
  const keep = new Uint8Array(stats.length + 1);
  let letters = 0;
  let letterInk = 0;
  let top = Infinity;
  let bottom = -Infinity;
  const minH = pageH * LETTER_H.min;
  const maxH = pageH * LETTER_H.max;
  for (const s of stats) {
    const cx = (s.minX + s.maxX) / 2;
    const cy = (s.minY + s.maxY) / 2;
    const inSeed = cx >= seed.x && cx < seed.x + seed.w && cy >= seed.y && cy < seed.y + seed.h;
    const bh = s.maxY - s.minY + 1;
    // Signos y acentos son chicos: se aceptan si están rodeados de halo, sin contar como letra.
    if (!inSeed || bh > maxH || s.area < 6) continue;
    if (haloAround(labels, s, light, w, h) < HALO_SHARE) continue;
    keep[s.label] = 1;
    letterInk += s.area;
    if (bh >= minH) {
      letters++;
      top = Math.min(top, s.minY);
      bottom = Math.max(bottom, s.maxY);
    }
  }
  if (letters < MIN_LETTERS || (bottom - top + 1) / seed.h < LETTER_SPAN) return null;

  // La máscara: las letras, agrandadas hasta cubrir su halo.
  const letterMask = new Uint8Array(n);
  for (let p = 0; p < n; p++) if (keep[labels[p]]) letterMask[p] = 1;
  const grown = dilate(letterMask, w, h, HALO);
  const mask = new Uint8Array(n);
  let masked = 0;
  for (let p = 0; p < n; p++) {
    // El halo es lo claro alrededor de la letra; lo oscuro que no es letra (la trama, una
    // línea) se queda en el dibujo.
    if (letterMask[p] || (grown[p] && light[p])) {
      mask[p] = 1;
      masked++;
    }
  }

  const filled = fill(px, mask, w, h);
  if (!filled) return null;

  const alpha = new Uint8Array(n);
  for (let p = 0; p < n; p++) if (mask[p]) alpha[p] = 255;
  return { alpha, filled, ink: letterInk / n };
}

/** Qué parte del anillo que rodea a la mancha es halo blanco. */
function haloAround(
  labels: Int32Array,
  s: { label: number; minX: number; minY: number; maxX: number; maxY: number },
  light: Uint8Array,
  w: number,
  h: number,
): number {
  let ring = 0;
  let white = 0;
  const x0 = Math.max(0, s.minX - RING - 1);
  const x1 = Math.min(w - 1, s.maxX + RING + 1);
  const y0 = Math.max(0, s.minY - RING - 1);
  const y1 = Math.min(h - 1, s.maxY + RING + 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = y * w + x;
      if (labels[p] === s.label) continue;
      // ¿Toca la letra a menos de RING píxeles?
      let near = false;
      for (let dy = -RING; dy <= RING && !near; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -RING; dx <= RING; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w && labels[yy * w + xx] === s.label) {
            near = true;
            break;
          }
        }
      }
      if (!near) continue;
      ring++;
      if (light[p]) white++;
    }
  }
  return ring ? white / ring : 0;
}

/** Lado de los cuadritos con que se rellena, y el borde con que se mira el empalme. */
const TILE = 12;
const BORDER = 3;

/**
 * Tapa la máscara de a cuadritos, de afuera hacia adentro. Cada cuadrito se copia desde un
 * lugar cercano ya limpio —lo de alrededor o un cuadrito ya rellenado—, el que mejor empalma
 * con su borde: en una trama o en líneas paralelas, el desplazamiento justo la continúa sin
 * que se note. Si algún cuadrito no empalma con nada, devuelve null y no se toca nada.
 */
function fill(px: Uint8ClampedArray, mask: Uint8Array, w: number, h: number): Uint8ClampedArray | null {
  const out = new Uint8ClampedArray(px);
  const gray = new Float32Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) gray[p] = lum(px, i);
  const known = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) known[p] = mask[p] ? 0 : 1;

  type Tile = { x: number; y: number; pts: number[] };
  let pending: Tile[] = [];
  for (let ty = 0; ty < h; ty += TILE) {
    for (let tx = 0; tx < w; tx += TILE) {
      const pts: number[] = [];
      for (let y = ty; y < Math.min(h, ty + TILE); y++) {
        for (let x = tx; x < Math.min(w, tx + TILE); x++) if (mask[y * w + x]) pts.push(y * w + x);
      }
      if (pts.length) pending.push({ x: tx, y: ty, pts });
    }
  }

  let seams = 0;
  let count = 0;
  while (pending.length) {
    // El cuadrito con más borde ya limpio: así se avanza de afuera hacia adentro.
    let pick = -1;
    let ringBest: number[] = [];
    for (let k = 0; k < pending.length; k++) {
      const t = pending[k];
      const ring: number[] = [];
      for (let y = Math.max(0, t.y - BORDER); y < Math.min(h, t.y + TILE + BORDER); y++) {
        for (let x = Math.max(0, t.x - BORDER); x < Math.min(w, t.x + TILE + BORDER); x++) {
          const p = y * w + x;
          if (known[p]) ring.push(p);
        }
      }
      if (ring.length > ringBest.length) {
        ringBest = ring;
        pick = k;
      }
    }
    if (pick < 0 || ringBest.length < 6) return null;
    const t = pending[pick];
    pending = pending.filter((_, k) => k !== pick);

    let best: { shift: number; cost: number } | null = null;
    for (let dy = -REACH; dy <= REACH; dy++) {
      const y0 = t.y - BORDER + dy;
      const y1 = t.y + TILE + BORDER + dy;
      if (y0 < 0 || y1 > h) continue;
      for (let dx = -REACH; dx <= REACH; dx++) {
        if (Math.abs(dx) < TILE && Math.abs(dy) < TILE) continue;
        const x0 = t.x - BORDER + dx;
        const x1 = t.x + TILE + BORDER + dx;
        if (x0 < 0 || x1 > w) continue;
        const shift = dy * w + dx;
        let ok = true;
        for (const p of t.pts) {
          if (!known[p + shift]) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        let cost = 0;
        for (const p of ringBest) {
          const d = gray[p] - gray[p + shift];
          cost += d * d;
          if (best && cost >= best.cost) break;
        }
        if (!best || cost < best.cost) best = { shift, cost };
      }
    }
    if (!best) return null;
    const seam = Math.sqrt(best.cost / ringBest.length);
    if (seam > MAX_SEAM * 1.6) return null;
    seams += seam;
    count++;
    for (const p of t.pts) {
      const q = p + best.shift;
      const i = p * 4;
      const j = q * 4;
      out[i] = out[j];
      out[i + 1] = out[j + 1];
      out[i + 2] = out[j + 2];
      out[i + 3] = 255;
      gray[p] = gray[q];
      known[p] = 1;
    }
  }
  return count && seams / count <= MAX_SEAM ? out : null;
}

import type { Detection } from "./detector";
import { components, type Point } from "./vision";

/**
 * Separación del diálogo: el texto sale del arte y queda como sprite aparte.
 *
 * Un globo apoyado sobre arte denso no se puede quitar —debajo no hay dibujo—, pero el
 * interior del globo es papel plano. Así que se oculta el texto y no el globo: se recorta
 * como sprite y el hueco se rellena con el mismo tono que lo rodea. Es exacto, no necesita
 * reconstruir nada, y funciona igual sobre fondo blanco que sobre una página de batalla.
 */

/** Margen alrededor del texto que también se limpia, para no dejar restos de antialiasing. */
const DILATE = 3;
/** A partir de qué nivel un píxel cuenta como papel. */
const PAPER_LEVEL = 195;
/** Piso de papel visible dentro del bloque. */
const MIN_PAPER_RATIO = 0.22;
/** Fracción máxima de la tinta que puede concentrarse en una sola mancha. */
const MAX_BLOB_SHARE = 0.86;
/** Mínimo de manchas separadas para que el bloque parezca escrito. */
const MIN_BLOBS = 2;
/** Techo de tamaño de un bloque, como fracción de la página. */
export const MAX_TEXT_AREA_RATIO = 0.04;

export type Sprite = {
  /** Píxeles con alfa: las letras opacas, el papel transparente. */
  image: ImageData;
  rect: { x: number; y: number; w: number; h: number };
  /** Proporción de tinta: aproxima cuánto hay para leer, y de ahí sale la pausa. */
  ink: number;
};

/**
 * ¿Se puede borrar el texto sin que se note?
 *
 * Lo que decide es **de qué tono es el fondo**, no cuánto fondo hay. Un diálogo con letra
 * gruesa llena de tinta su propio bloque —baja al 0.37 de papel— y aun así está sobre un
 * globo blanco; pedirle una proporción alta lo dejaba sin levantar. Sobre el dibujo, en
 * cambio, ni la parte más clara llega a ser papel.
 */
function isSafeToLift(levels: Uint8Array): boolean {
  if (!levels.length) return false;
  const sorted = Uint8Array.from(levels).sort();
  const background = sorted[Math.floor(sorted.length * 0.85)];
  let paper = 0;
  for (const v of levels) if (v >= PAPER_LEVEL) paper++;
  return background >= PAPER_LEVEL && paper / levels.length >= MIN_PAPER_RATIO;
}

/**
 * ¿La tinta de este bloque está escrita, o es un pedazo de dibujo?
 *
 * En un diálogo la tinta se reparte entre las letras; en un trozo de dibujo se concentra en
 * una forma que domina el bloque. Medido sobre una página real, un dibujo marcado como texto
 * concentra el 0.91 en una sola mancha mientras que los diálogos van de 0.05 a 0.82 —incluso
 * los de dos caracteres—. Contar manchas no sirve: ese mismo dibujo tenía 23.
 */
function looksLikeText(alpha: Uint8Array, w: number, h: number): boolean {
  const ink = new Uint8Array(w * h);
  let total = 0;
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] > 60) {
      ink[i] = 1;
      total++;
    }
  }
  if (!total) return false;

  const { stats } = components(ink, w, h);
  const areas = stats.map((s) => s.area).filter((a) => a >= 6);
  if (areas.length < MIN_BLOBS) return false;
  return Math.max(...areas) / total <= MAX_BLOB_SHARE;
}

/**
 * Levanta el texto de la página y devuelve su sprite.
 *
 * `ctx` es la página completa y se modifica: donde estaba el texto queda el tono del papel.
 */
export async function lift(
  ctx: CanvasRenderingContext2D,
  text: Detection,
  pageArea: number,
): Promise<Sprite | null> {
  const { x, y, w, h } = text.bbox;
  if (w * h > MAX_TEXT_AREA_RATIO * pageArea) return null; // es dibujo, no diálogo

  const x0 = Math.max(0, Math.floor(x) - DILATE);
  const y0 = Math.max(0, Math.floor(y) - DILATE);
  const cw = Math.min(ctx.canvas.width - x0, Math.ceil(w) + DILATE * 2);
  const ch = Math.min(ctx.canvas.height - y0, Math.ceil(h) + DILATE * 2);
  if (cw < 3 || ch < 3) return null;

  const region = ctx.getImageData(x0, y0, cw, ch);
  const px = region.data;
  const count = cw * ch;

  const levels = new Uint8Array(count);
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    levels[p] = Math.max(px[i], px[i + 1], px[i + 2]);
  }
  if (!isSafeToLift(levels)) return null;

  // El papel del bloque: percentil alto, no la media, que estaría ensuciada por las letras.
  const sorted = Uint8Array.from(levels).sort();
  const paper = sorted[Math.floor(count * 0.85)];

  // El alfa sale de la tinta, así el sprite son las letras y no un recuadro blanco.
  const alpha = new Uint8Array(count);
  let ink = 0;
  for (let p = 0; p < count; p++) {
    const a = Math.max(0, Math.min(255, ((paper - levels[p]) * 255) / Math.max(paper, 1)));
    alpha[p] = a;
    if (a > 40) ink++;
  }
  if (ink / count < 0.005) return null;
  if (!looksLikeText(alpha, cw, ch)) return null;

  // El sprite conserva el color original con el alfa de la tinta.
  const out = new ImageData(cw, ch);
  for (let p = 0, i = 0; p < count; p++, i += 4) {
    out.data[i] = px[i];
    out.data[i + 1] = px[i + 1];
    out.data[i + 2] = px[i + 2];
    out.data[i + 3] = alpha[p];
  }

  // Y el hueco se tapa con el tono del papel.
  ctx.fillStyle = `rgb(${paper},${paper},${paper})`;
  ctx.fillRect(x0, y0, cw, ch);

  return { image: out, rect: { x: x0, y: y0, w: cw, h: ch }, ink: ink / count };
}

/** Fracción de `inner` que cae dentro del polígono. */
export function insidePolygon(polygon: Point[], inner: { x: number; y: number; w: number; h: number }) {
  const step = 5;
  let hits = 0;
  let total = 0;
  for (let i = 0; i <= step; i++) {
    for (let j = 0; j <= step; j++) {
      const px = inner.x + (inner.w * i) / step;
      const py = inner.y + (inner.h * j) / step;
      total++;
      if (contains(polygon, px, py)) hits++;
    }
  }
  return total ? hits / total : 0;
}

/** Punto en polígono por cruce de rayos. */
function contains(polygon: Point[], px: number, py: number): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

import type { Detection } from "./detector";

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

import type { Point } from "./vision";

/**
 * Cuánta tensión tiene una viñeta, para dirigir la cámara en el modo experimental.
 *
 * Es la idea de DynamicManga (Cao et al., 2016): el estado de una viñeta se lee mejor en lo
 * que el autor dibuja alrededor de los personajes —líneas de velocidad, fondo, forma de los
 * globos y de la viñeta— que en los personajes mismos, y una escena cambia de a poco, así
 * que cada viñeta se suaviza con sus vecinas.
 */

/**
 * Qué tan dentada es una silueta: su perímetro al cuadrado sobre el de un círculo de la
 * misma área. Un globo en elipse da cerca de 1; uno en estallido, bastante más.
 */
export function jaggedness(polygon: Point[]): number {
  if (polygon.length < 3) return 1;
  let area = 0;
  let perimeter = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    area += polygon[j][0] * polygon[i][1] - polygon[i][0] * polygon[j][1];
    perimeter += Math.hypot(polygon[i][0] - polygon[j][0], polygon[i][1] - polygon[j][1]);
  }
  area = Math.abs(area) / 2;
  return area > 0 ? (perimeter * perimeter) / (4 * Math.PI * area) : 1;
}

/** Cuánto se aparta una viñeta de estar derecha: 0 si sus lados van en los ejes, 1 si están a 45°. */
export function tilt(polygon: Point[]): number {
  let sum = 0;
  let len = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const dx = polygon[i][0] - polygon[j][0];
    const dy = polygon[i][1] - polygon[j][1];
    const l = Math.hypot(dx, dy);
    if (l < 1) continue;
    const a = Math.abs(Math.atan2(dy, dx)) % (Math.PI / 2);
    sum += (Math.min(a, Math.PI / 2 - a) / (Math.PI / 4)) * l;
    len += l;
  }
  return len ? sum / len : 0;
}

/**
 * La tensión de una viñeta, de 0 a 1, con pistas que el autor dibuja para eso: tinta y fondo
 * oscuro, globos dentados y viñetas torcidas.
 *
 * Las líneas de velocidad serían la mejor pista, pero detectarlas bien todavía no: lo que se
 * probó encontraba sobre todo bordes de viñeta y contornos.
 */
export function tension(f: { ink: number; jagged: number; tilt: number }): number {
  const ink = Math.min(1, Math.max(0, (f.ink - 0.12) / 0.4));
  const jag = Math.min(1, Math.max(0, (f.jagged - 1.15) / 0.8));
  const tilted = Math.min(1, f.tilt * 4);
  return Math.min(1, 0.5 * ink + 0.3 * jag + 0.2 * tilted);
}

/** Suaviza la tensión con las viñetas vecinas en orden de lectura: una escena cambia de a poco. */
export function smooth(values: number[]): number[] {
  return values.map((v, i) => {
    const prev = values[i - 1] ?? v;
    const next = values[i + 1] ?? v;
    return 0.6 * v + 0.2 * prev + 0.2 * next;
  });
}

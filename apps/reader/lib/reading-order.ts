import type { Point } from "./vision";

/**
 * Orden de lectura de las viñetas de una página.
 *
 * Es el algoritmo de `manga109/panel-order-estimator` (Kovanen et al.), el mismo que usa el
 * pipeline de Python. Se parte el conjunto recursivamente por un pivote: primero horizontal
 * —la lectura se estructura en filas antes que en columnas— y después vertical, tomando en
 * cada eje el pivote que menos rebana.
 *
 * Lo que hace que funcione en manga de acción es que el pivote **no** exige un gutter limpio:
 * puede atravesar viñetas mientras a ninguna le recorte más que el umbral. Sin esa tolerancia
 * las páginas con bordes diagonales quedan sin separar.
 */

export type Box = { x: number; y: number; w: number; h: number };

/** Fracción máxima de una viñeta que un pivote puede dejar del lado equivocado. */
export const DEFAULT_THRESHOLD = 0.15;
/** Cuánto tienen que compartir dos viñetas en vertical para considerarse de la misma fila. */
const SAME_ROW_RATIO = 0.5;

const area = (poly: Point[]): number => {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
};

/** Recorta el polígono al semiplano de un lado del pivote (Sutherland-Hodgman). */
function clip(poly: Point[], axis: 0 | 1, pivot: number, keepLower: boolean): Point[] {
  const out: Point[] = [];
  const inside = (p: Point) => (keepLower ? p[axis] <= pivot : p[axis] >= pivot);

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const aIn = inside(a);
    if (aIn) out.push(a);
    if (aIn !== inside(b)) {
      const span = b[axis] - a[axis];
      if (span) {
        const t = (pivot - a[axis]) / span;
        out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      }
    }
  }
  return out;
}

type Split = { lower: number[]; upper: number[]; worst: number };

/**
 * Reparte las viñetas a ambos lados del pivote, o null si a alguna le recorta demasiado.
 *
 * Una viñeta que el pivote roza se asigna entera al lado donde tiene más área. Devuelve
 * además cuánto le rebanó a la más afectada, que es con lo que se comparan los pivotes.
 */
function split(polys: Point[][], axis: 0 | 1, pivot: number, threshold: number): Split | null {
  const lower: number[] = [];
  const upper: number[] = [];
  let worst = 0;

  for (let i = 0; i < polys.length; i++) {
    const total = area(polys[i]);
    if (total <= 0) continue;
    const below = area(clip(polys[i], axis, pivot, true));
    const above = total - below;
    const cut = Math.min(below, above) / total;
    if (cut > threshold) return null;
    if (cut > worst) worst = cut;
    (below >= above ? lower : upper).push(i);
  }

  if (!lower.length || !upper.length) return null;
  return { lower, upper, worst };
}

/** Candidatos a pivote: los bordes de las viñetas, que es donde caen los gutters. */
function pivots(polys: Point[][], axis: 0 | 1): number[] {
  const edges = new Set<number>();
  for (const poly of polys) {
    let min = Infinity;
    let max = -Infinity;
    for (const p of poly) {
      if (p[axis] < min) min = p[axis];
      if (p[axis] > max) max = p[axis];
    }
    edges.add(min);
    edges.add(max);
  }
  return [...edges].sort((a, b) => a - b);
}

const extent = (poly: Point[], axis: 0 | 1): [number, number] => {
  let min = Infinity;
  let max = -Infinity;
  for (const p of poly) {
    if (p[axis] < min) min = p[axis];
    if (p[axis] > max) max = p[axis];
  }
  return [min, max];
};

/**
 * Ordena un grupo que ningún pivote pudo separar.
 *
 * El estimador original les asigna un único orden; acá hace falta uno total. Si dos viñetas
 * comparten franja vertical manda la columna —derecha primero en manga— y si no la comparten
 * manda la altura. Ordenar solo por altura invertía filas enteras cuando una viñeta empezaba
 * unos píxeles más arriba que su vecina.
 */
function untangle(idx: number[], shapes: Point[][], rtl: boolean): number[] {
  const n = idx.length;
  const spans = idx.map((i) => ({ x: extent(shapes[i], 0), y: extent(shapes[i], 1) }));

  const after: Set<number>[] = Array.from({ length: n }, () => new Set());
  const indegree = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = spans[i];
      const b = spans[j];
      const overlap = Math.min(a.y[1], b.y[1]) - Math.max(a.y[0], b.y[0]);
      const sameRow = overlap > SAME_ROW_RATIO * Math.min(a.y[1] - a.y[0], b.y[1] - b.y[0]);

      let first: number;
      let second: number;
      if (sameRow) {
        [first, second] = (a.x[1] > b.x[1]) === rtl ? [i, j] : [j, i];
      } else {
        [first, second] = a.y[0] <= b.y[0] ? [i, j] : [j, i];
      }
      if (!after[first].has(second)) {
        after[first].add(second);
        indegree[second]++;
      }
    }
  }

  const rank = (k: number) => spans[k].y[0] * 1e6 + (rtl ? -spans[k].x[1] : spans[k].x[0]);
  const ready = Array.from({ length: n }, (_, k) => k)
    .filter((k) => indegree[k] === 0)
    .sort((a, b) => rank(a) - rank(b));

  const out: number[] = [];
  while (ready.length) {
    const k = ready.shift()!;
    out.push(idx[k]);
    for (const next of [...after[k]].sort((a, b) => rank(a) - rank(b))) {
      if (--indegree[next] === 0) ready.push(next);
    }
    ready.sort((a, b) => rank(a) - rank(b));
  }

  if (out.length < n) {
    // Ciclo entre precedencias: se completa por cercanía al origen de lectura.
    const done = new Set(out);
    for (const k of Array.from({ length: n }, (_, i) => i).sort((a, b) => rank(a) - rank(b))) {
      if (!done.has(idx[k])) out.push(idx[k]);
    }
  }
  return out;
}

/**
 * Índices de las viñetas en orden de lectura.
 *
 * `shapes` son las siluetas. Sin ellas se usan las esquinas de la caja, que en viñetas
 * diagonales exagera el área y hace más difícil separar.
 */
export function readingOrder(
  boxes: Box[],
  options: { rtl?: boolean; polygons?: Point[][]; threshold?: number } = {},
): number[] {
  const { rtl = true, threshold = DEFAULT_THRESHOLD } = options;
  const shapes: Point[][] =
    options.polygons ??
    boxes.map((b) => [
      [b.x, b.y],
      [b.x + b.w, b.y],
      [b.x + b.w, b.y + b.h],
      [b.x, b.y + b.h],
    ]);

  const walk = (idx: number[]): number[] => {
    if (idx.length <= 1) return idx;
    const polys = idx.map((i) => shapes[i]);

    /** El pivote que menos rebana, de todos los que separan sobre este eje. */
    const best = (axis: 0 | 1): Split | null => {
      let found: Split | null = null;
      for (const pivot of pivots(polys, axis)) {
        const parts = split(polys, axis, pivot, threshold);
        if (parts && (!found || parts.worst < found.worst)) {
          found = parts;
          if (found.worst === 0) break; // corte limpio: no hay nada mejor
        }
      }
      return found;
    };

    const horizontal = best(1);
    const vertical = best(0);

    // Las filas mandan sobre las columnas, pero solo a igualdad de limpieza. Quedarse con
    // el primer horizontal que pase el umbral le rebana la punta a una viñeta que ocupa
    // toda la altura y la empuja abajo, dejando arriba a su vecina angosta.
    if (horizontal && (!vertical || horizontal.worst <= vertical.worst)) {
      return [
        ...walk(horizontal.lower.map((i) => idx[i])),
        ...walk(horizontal.upper.map((i) => idx[i])),
      ];
    }
    if (vertical) {
      const left = vertical.lower.map((i) => idx[i]);
      const right = vertical.upper.map((i) => idx[i]);
      const [first, second] = rtl ? [right, left] : [left, right];
      return [...walk(first), ...walk(second)];
    }

    return untangle(idx, shapes, rtl);
  };

  return walk(boxes.map((_, i) => i));
}

/**
 * Las operaciones de visión que el pipeline necesita, sobre máscaras binarias.
 *
 * En el pipeline de Python esto lo hace OpenCV. Traerlo al navegador serían 8 MB de WASM
 * para usar cuatro funciones —más peso que los propios modelos—, así que están acá: apertura
 * morfológica, componentes conexos, trazado de contorno y simplificación.
 *
 * Las máscaras son `Uint8Array` de w×h con 0 o 1, en filas.
 */

export type Point = [number, number];

/**
 * Erosión seguida de dilatación, con un disco de radio `r`.
 *
 * Corta los hilos de un píxel que las máscaras traen y que al contornearlos aparecen como
 * puentes cruzando la página. Se hace en dos pasadas de una dimensión cada una, que da el
 * mismo resultado que el disco y cuesta muchísimo menos.
 */
export function open(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask;
  return dilate(erode(mask, w, h, r), w, h, r);
}

/**
 * Desenfoque de caja, en el sitio.
 *
 * Separable y con ventana deslizante, así que cuesta lo mismo con radio 2 que con radio 20.
 * Dos pasadas se parecen bastante a una gaussiana, que es todo lo que hace falta acá.
 */
export function boxBlur(data: Float32Array, w: number, h: number, r: number): void {
  if (r <= 0 || w <= 0 || h <= 0) return;
  const span = 2 * r + 1;
  const tmp = new Float32Array(data.length);
  const cx = (x: number) => Math.min(Math.max(x, 0), w - 1);
  const cy = (y: number) => Math.min(Math.max(y, 0), h - 1);

  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += data[row + cx(x)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / span;
      sum -= data[row + cx(x - r)];
      sum += data[row + cx(x + r + 1)];
    }
  }

  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[cy(y) * w + x];
    for (let y = 0; y < h; y++) {
      data[y * w + x] = sum / span;
      sum -= tmp[cy(y - r) * w + x];
      sum += tmp[cy(y + r + 1) * w + x];
    }
  }
}

export function erode(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  return morph(mask, w, h, r, true);
}

function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  return morph(mask, w, h, r, false);
}

/** Erosión o dilatación separable: primero horizontal, después vertical. */
function morph(mask: Uint8Array, w: number, h: number, r: number, erosion: boolean): Uint8Array {
  const pass = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  const hit = erosion ? 0 : 1;

  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let found = false;
      for (let d = -r; d <= r && !found; d++) {
        const xx = x + d;
        if (xx < 0 || xx >= w) {
          // Fuera del borde se asume fondo: erosionar contra el borde recorta, dilatar no.
          if (erosion) found = true;
          continue;
        }
        if (mask[row + xx] === hit) found = true;
      }
      pass[row + x] = erosion ? (found ? 0 : 1) : found ? 1 : 0;
    }
  }

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let found = false;
      for (let d = -r; d <= r && !found; d++) {
        const yy = y + d;
        if (yy < 0 || yy >= h) {
          if (erosion) found = true;
          continue;
        }
        if (pass[yy * w + x] === hit) found = true;
      }
      out[y * w + x] = erosion ? (found ? 0 : 1) : found ? 1 : 0;
    }
  }
  return out;
}

export type Component = { label: number; area: number; minX: number; minY: number; maxX: number; maxY: number };

/**
 * Etiqueta las regiones conexas (vecindad de 8) y devuelve sus estadísticas.
 *
 * Se usa para quedarse con la región mayor: las máscaras traen fragmentos sueltos que, si se
 * contornean junto con la forma principal, producen líneas que atraviesan la viñeta.
 */
export function components(mask: Uint8Array, w: number, h: number) {
  const labels = new Int32Array(w * h);
  const stats: Component[] = [];
  const queue = new Int32Array(w * h);
  let next = 0;

  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || labels[i]) continue;
    next++;
    const stat: Component = { label: next, area: 0, minX: w, minY: h, maxX: 0, maxY: 0 };

    let head = 0;
    let tail = 0;
    queue[tail++] = i;
    labels[i] = next;

    while (head < tail) {
      const p = queue[head++];
      const y = (p / w) | 0;
      const x = p - y * w;
      stat.area++;
      if (x < stat.minX) stat.minX = x;
      if (y < stat.minY) stat.minY = y;
      if (x > stat.maxX) stat.maxX = x;
      if (y > stat.maxY) stat.maxY = y;

      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (mask[q] && !labels[q]) {
            labels[q] = next;
            queue[tail++] = q;
          }
        }
      }
    }
    stats.push(stat);
  }

  return { labels, stats };
}

/** Deja solo la región conexa de mayor área. */
export function largestComponent(mask: Uint8Array, w: number, h: number): Uint8Array {
  const { labels, stats } = components(mask, w, h);
  if (stats.length <= 1) return mask;

  let best = stats[0];
  for (const s of stats) if (s.area > best.area) best = s;

  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) if (labels[i] === best.label) out[i] = 1;
  return out;
}

/**
 * Contorno externo de la máscara, en sentido horario (trazado de Moore).
 *
 * Se recorre el borde manteniendo la mano sobre el fondo, girando en cada paso desde el
 * vecino por el que se llegó. Termina al volver al punto inicial con la misma dirección,
 * que es lo que evita quedarse dando vueltas en formas con estrangulamientos.
 */
export function traceContour(mask: Uint8Array, w: number, h: number): Point[] {
  let start = -1;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) {
      start = i;
      break;
    }
  }
  if (start < 0) return [];

  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : mask[y * w + x]);
  // Vecinos en sentido horario desde la izquierda.
  const around = [
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
  ] as const;

  const sy = (start / w) | 0;
  const sx = start - sy * w;
  const contour: Point[] = [[sx, sy]];

  let cx = sx;
  let cy = sy;
  // Último punto de fondo visto. Se arranca por la izquierda del inicial, que es fondo
  // seguro: el punto inicial es el primero en orden de barrido.
  let bgx = sx - 1;
  let bgy = sy;
  const limit = w * h * 4;

  for (let step = 0; step < limit; step++) {
    // Se gira alrededor del píxel actual empezando por el fondo conocido, y se toma el
    // primer vecino con figura. El fondo justo anterior a él es el que guía el paso
    // siguiente: es lo que mantiene la mano apoyada sobre el borde.
    let dir = around.findIndex(([dx, dy]) => cx + dx === bgx && cy + dy === bgy);
    if (dir < 0) dir = 0;

    let moved = false;
    for (let k = 1; k <= 8; k++) {
      const d = (dir + k) % 8;
      const nx = cx + around[d][0];
      const ny = cy + around[d][1];
      if (!at(nx, ny)) {
        bgx = nx;
        bgy = ny;
        continue;
      }
      cx = nx;
      cy = ny;
      moved = true;
      break;
    }
    if (!moved) break; // píxel aislado
    if (cx === sx && cy === sy) break;
    contour.push([cx, cy]);
  }

  return contour;
}

/**
 * Simplificación de Douglas-Peucker con épsilon en píxeles.
 *
 * Medido sobre el material real: los contornos vienen con más de 200 vértices y con 2 px
 * quedan en unos 20, conservando la silueta. Un épsilon proporcional al perímetro deforma
 * justo los contornos ruidosos, que son los que más cuidado necesitan.
 */
export function simplify(points: Point[], eps: number): Point[] {
  if (points.length < 3) return points;

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    if (last <= first + 1) continue;

    const [x1, y1] = points[first];
    const [x2, y2] = points[last];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;

    let worst = 0;
    let index = first;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i];
      const d = Math.abs(dy * px - dx * py + x2 * y1 - y2 * x1) / len;
      if (d > worst) {
        worst = d;
        index = i;
      }
    }

    if (worst > eps) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  return points.filter((_, i) => keep[i]);
}

/** Envolvente convexa por recorrido de Andrew, en sentido horario. */
export function convexHull(points: Point[]): Point[] {
  if (points.length < 4) return points;
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Point, a: Point, b: Point) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const half = (pts: Point[]) => {
    const out: Point[] = [];
    for (const p of pts) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };

  return [...half(sorted), ...half([...sorted].reverse())];
}

/** Área con signo por la fórmula del cordón de zapato. */
export function polygonArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/** Caja que contiene al polígono. */
export function boundsOf(points: Point[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Reescala una imagen RGBA como OpenCV: al achicar, promediando el área que cubre cada
 * píxel (`cv2.INTER_AREA`); al agrandar, con interpolación bilineal (`cv2.INTER_LINEAR`).
 *
 * `drawImage` no sirve: cada navegador reescala a su manera —y Chrome distinto que
 * Firefox—, y en una viñeta límite esa diferencia pasa la confianza de 0.58 a 0.09 y la
 * viñeta desaparece. Hecho acá, el navegador ve lo mismo que el pipeline de Python.
 *
 * Al achicar, el bilineal no alcanza: toma cuatro píxeles e ignora el resto, y en una trama
 * o en líneas finas eso las rompe en un patrón que confunde al modelo. Una viñeta de Saint
 * Seiya pasaba de 0.86 a 0.06 así; promediando el área, sobre páginas de tres mangas, se
 * detectan igual o más viñetas.
 *
 * Devuelve los tres canales en planos separados (CHW), normalizados a 0–1, dentro de un
 * lienzo de `size`×`size` relleno con `pad`, con la imagen anclada arriba a la izquierda.
 */
export function resizeToPlanes(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
  size: number,
  pad: number,
): Float32Array {
  const plane = size * size;
  const out = new Float32Array(3 * plane).fill(pad / 255);
  if (dw < sw && dh < sh) {
    resizeByArea(src, sw, sh, dw, dh, size, out);
    return out;
  }

  // Centros de píxel alineados, como OpenCV: `(d + 0.5) * escala - 0.5`, recortado al borde.
  const axis = (d: number, from: number, to: number) => {
    const s = Math.min(Math.max((d + 0.5) * (from / to) - 0.5, 0), from - 1);
    const i0 = Math.floor(s);
    return { i0, i1: Math.min(i0 + 1, from - 1), f: s - i0 };
  };
  const xs = Array.from({ length: dw }, (_, x) => axis(x, sw, dw));

  for (let y = 0; y < dh; y++) {
    const { i0: y0, i1: y1, f: fy } = axis(y, sh, dh);
    const r0 = y0 * sw;
    const r1 = y1 * sw;
    for (let x = 0; x < dw; x++) {
      const { i0: x0, i1: x1, f: fx } = xs[x];
      const a = (r0 + x0) * 4;
      const b = (r0 + x1) * 4;
      const c = (r1 + x0) * 4;
      const d = (r1 + x1) * 4;
      const p = y * size + x;
      for (let ch = 0; ch < 3; ch++) {
        const top = src[a + ch] + (src[b + ch] - src[a + ch]) * fx;
        const bottom = src[c + ch] + (src[d + ch] - src[c + ch]) * fx;
        out[ch * plane + p] = Math.round(top + (bottom - top) * fy) / 255;
      }
    }
  }
  return out;
}

/** Qué píxeles de origen cubre cada píxel de destino, y con qué peso. */
function areaWeights(from: number, to: number): { index: number; weight: number }[][] {
  const scale = from / to;
  return Array.from({ length: to }, (_, d) => {
    const start = d * scale;
    const end = Math.min(from, (d + 1) * scale);
    const cells: { index: number; weight: number }[] = [];
    for (let i = Math.floor(start); i < Math.ceil(end); i++) {
      const weight = Math.min(end, i + 1) - Math.max(start, i);
      if (weight > 1e-9) cells.push({ index: i, weight: weight / scale });
    }
    return cells;
  });
}

/** Achica promediando el área que cubre cada píxel: primero a lo ancho, después a lo alto. */
function resizeByArea(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
  size: number,
  out: Float32Array,
): void {
  const plane = size * size;
  const cols = areaWeights(sw, dw);
  const rows = areaWeights(sh, dh);

  const narrow = new Float32Array(sh * dw * 3);
  for (let y = 0; y < sh; y++) {
    const row = y * sw * 4;
    for (let x = 0; x < dw; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (const { index, weight } of cols[x]) {
        const i = row + index * 4;
        r += src[i] * weight;
        g += src[i + 1] * weight;
        b += src[i + 2] * weight;
      }
      const o = (y * dw + x) * 3;
      narrow[o] = r;
      narrow[o + 1] = g;
      narrow[o + 2] = b;
    }
  }

  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (const { index, weight } of rows[y]) {
        const o = (index * dw + x) * 3;
        r += narrow[o] * weight;
        g += narrow[o + 1] * weight;
        b += narrow[o + 2] * weight;
      }
      const p = y * size + x;
      out[p] = Math.round(r) / 255;
      out[plane + p] = Math.round(g) / 255;
      out[2 * plane + p] = Math.round(b) / 255;
    }
  }
}

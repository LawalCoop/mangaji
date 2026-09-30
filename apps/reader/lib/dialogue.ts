import type { Detection } from "./detector";
import type { Rect } from "./types";
import { boxBlur, components, erode, type Point } from "./vision";

/**
 * Separación del diálogo: el texto sale del arte y queda como sprite aparte.
 *
 * Un globo apoyado sobre arte denso no se puede quitar —debajo no hay dibujo—, pero el
 * interior del globo es papel plano. Así que se oculta el texto y no el globo: se recorta
 * como sprite y el hueco se rellena con el mismo tono que lo rodea. Es exacto, no necesita
 * reconstruir nada, y funciona igual sobre fondo blanco que sobre una página de batalla.
 */

/** Aire alrededor de la caja del detector, para poder seguir las letras que la cruzan. */
const MARGIN = 14;
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

/** Cuánto se estira lo que rodea a un trazo para taparlo. */
const FEATHER = 10;
/** A partir de qué alfa un píxel cuenta como trazo. */
const INK_LEVEL = 40;
/** Cuánto se agranda la máscara de un trazo, para alcanzar su halo. */
const SPREAD = 2;
/** Qué parte del contorno del bloque puede rozar una mancha sin dejar de ser una letra. */
const EDGE_SHARE = 0.25;
/**
 * Cuánto se satura el alfa al borrar dentro de un globo.
 *
 * El texto de un escaneo no termina en el trazo sino en un halo de grises; en proporción al
 * alfa ese halo queda a medio borrar y dibuja el contorno de cada letra. Adentro del globo no
 * hay nada que cuidar, así que todo lo que tenga algo de tinta se va entero.
 */
const ERASE_GAIN = 8;
/** Cuánto se mete la máscara del globo hacia adentro, para no comerse su contorno. */
const INSET = 3;
/** Qué parte de una mancha tiene que caer dentro del globo para borrarse. */
const INSIDE_SHARE = 0.5;

/**
 * Borra la tinta reemplazándola por lo que la rodea, difuminado.
 *
 * Antes se rellenaba de blanco el rectángulo entero de la detección. Era simple y quedaba
 * perfecto mientras la caja cayera dentro del globo, pero la caja se pasa seguido —no sigue
 * el contorno del globo— y entonces aparecía un bloque blanco de bordes rectos comiéndose el
 * dibujo, que es lo que se veía como un recorte grosero.
 *
 * El borrado va por manchas de tinta, no por rectángulo: lo que entra en la caja del detector
 * se borra entero, siga hasta donde siga. La caja recorta —típicamente por abajo— y borrar
 * solo lo que cae adentro deja las patas de las letras a la vista, que se leen como guiones
 * sueltos dentro del globo.
 *
 * Dentro de un globo eso alcanza, porque ahí solo hay diálogo sobre papel. Sin globo que lo
 * respalde —una onomatopeya suelta sobre el arte— además se exige que la mancha no cruce el
 * borde de la región, que es como se cuela el dibujo de al lado.
 */
export function erase(
  px: Uint8ClampedArray,
  alpha: Uint8Array,
  w: number,
  h: number,
  paper: number,
  inside?: Uint8Array,
  seed?: Rect,
): Float32Array {
  const count = w * h;
  const radius = Math.max(2, Math.min(FEATHER, Math.floor(Math.min(w, h) / 2)));
  const cover = new Float32Array(count);
  /** Píxeles que se borran de una mancha que no se va entera. */
  const partial = new Uint8Array(count);

  const ink = new Uint8Array(count);
  for (let p = 0; p < count; p++) ink[p] = alpha[p] > INK_LEVEL ? 1 : 0;
  const { labels, stats } = components(ink, w, h);

  // Qué manchas nacen dentro de la caja que marcó el detector. Se borran enteras, aunque
  // sigan fuera: la caja suele quedar corta —de ahí que se vieran las patas de las letras,
  // cortadas por abajo—, y una letra a medio borrar es peor que no haberla tocado.
  const touched = new Uint8Array(stats.length + 1);
  if (seed) {
    const sx1 = Math.min(w, seed.x + seed.w);
    const sy1 = Math.min(h, seed.y + seed.h);
    for (let y = Math.max(0, seed.y); y < sy1; y++) {
      for (let x = Math.max(0, seed.x); x < sx1; x++) touched[labels[y * w + x]] = 1;
    }
  } else {
    touched.fill(1);
  }

  // Qué es letra: cuánto del contorno de la región roza cada mancha. La letra queda holgada
  // adentro, mientras que el dibujo entra de afuera y lo cruza a lo largo.
  const contacts = new Int32Array(stats.length + 1);
  for (let x = 0; x < w; x++) {
    contacts[labels[x]]++;
    contacts[labels[(h - 1) * w + x]]++;
  }
  for (let y = 0; y < h; y++) {
    contacts[labels[y * w]]++;
    contacts[labels[y * w + w - 1]]++;
  }
  const border = 2 * (w + h);
  const isLetter = new Uint8Array(stats.length + 1);
  for (const stat of stats) {
    const label = stat.label;
    isLetter[label] = touched[label] && contacts[label] / border <= EDGE_SHARE ? 1 : 0;
  }

  if (inside) {
    // Estar dentro del globo no alcanza para borrar: hay que ser una de las manchas que el
    // detector marcó, y una letra. El contorno del globo, cuando está pegado a un fondo gris
    // —un pasillo, un cielo tramado—, forma una sola mancha con todo ese gris; la caja la
    // roza y se blanqueaba el rectángulo entero, que al revelarse el texto volvía a medias
    // y se veía como un cuadro claro alrededor del globo.
    //
    // Y la mancha tiene que caer mayormente adentro de la silueta del globo, que ya viene
    // metida unos píxeles: así un tramo del contorno cercano al texto, que por forma pasa por
    // letra, se queda. Se decide por mancha y no por píxel porque la silueta del modelo es
    // aproximada: una letra que se asoma un poco afuera se borra entera igual.
    const within = new Int32Array(stats.length + 1);
    for (let p = 0; p < count; p++) if (labels[p] && inside[p]) within[labels[p]]++;
    for (const stat of stats) {
      if (within[stat.label] < stat.area * INSIDE_SHARE) isLetter[stat.label] = 0;
    }
    //
    // Una línea que toca el contorno —la más ancha del globo, con letras gruesas que se
    // tocan entre sí— forma una sola mancha con él y no pasa por letra. De esa mancha se
    // borra lo que cae dentro de la silueta y de la caja del texto: la línea se va y el
    // contorno, que queda fuera de la silueta metida, se queda.
    const inSeed = (p: number) => {
      if (!seed) return true;
      const x = p % w;
      const y = (p / w) | 0;
      return x >= seed.x && x < seed.x + seed.w && y >= seed.y && y < seed.y + seed.h;
    };
    const gain = (p: number) => Math.min(1, (alpha[p] / 255) * ERASE_GAIN);
    for (let p = 0; p < count; p++) {
      const label = labels[p];
      if (!label) cover[p] = 0;
      else if (isLetter[label]) cover[p] = gain(p);
      else if (touched[label] && inside[p] && inSeed(p)) {
        cover[p] = gain(p);
        partial[p] = 1;
      } else cover[p] = 0;
    }
  } else {
    for (let p = 0; p < count; p++) cover[p] = labels[p] && isLetter[labels[p]] ? 1 : 0;
  }

  // El trazo se agranda un poco antes de taparlo, para alcanzar su halo; pero lo que se
  // agranda no puede pisar un trazo que se queda, como el contorno del globo.
  boxBlur(cover, w, h, SPREAD);
  for (let p = 0; p < count; p++) {
    cover[p] = labels[p] && !isLetter[labels[p]] && !partial[p] ? 0 : Math.min(1, cover[p] * 3);
  }

  // Un bloque cuyo fondo es papel es el interior de un globo, y ahí el hueco se tapa con
  // papel liso. Tomar el promedio de alrededor parece más fino pero es justo lo que ensucia:
  // un trazo pegado al dibujo arrastra su oscuridad y deja un velo gris dentro del globo.
  if (paper >= PAPER_LEVEL) {
    for (let p = 0, i = 0; p < count; p++, i += 4) {
      const a = cover[p];
      if (a <= 0) continue;
      px[i] = px[i] * (1 - a) + paper * a;
      px[i + 1] = px[i + 1] * (1 - a) + paper * a;
      px[i + 2] = px[i + 2] * (1 - a) + paper * a;
    }
    return cover;
  }

  // Sobre arte no hay papel con qué tapar, así que se usa lo que rodea a cada trazo. Lo que
  // se va a borrar no puede servir de muestra: si el halo de una letra contara como limpio,
  // el contorno reaparecería por la ventana de al lado.
  const weight = new Float32Array(count);
  const channels = [new Float32Array(count), new Float32Array(count), new Float32Array(count)];
  for (let p = 0, i = 0; p < count; p++, i += 4) {
    const clean = 1 - cover[p];
    weight[p] = clean;
    channels[0][p] = px[i] * clean;
    channels[1][p] = px[i + 1] * clean;
    channels[2][p] = px[i + 2] * clean;
  }

  boxBlur(weight, w, h, radius);
  for (const channel of channels) boxBlur(channel, w, h, radius);

  for (let p = 0, i = 0; p < count; p++, i += 4) {
    const a = cover[p];
    if (a <= 0) continue;

    const total = weight[p];
    for (let c = 0; c < 3; c++) {
      const around = total > 0.002 ? channels[c][p] / total : paper;
      px[i + c] = px[i + c] * (1 - a) + around * a;
    }
  }

  return cover;
}

/**
 * Rasteriza el globo que contiene al texto, recortado al bloque.
 *
 * Es lo que le dice al borrado hasta dónde puede llegar. Se mete unos píxeles hacia adentro
 * para no llevarse por delante la línea del propio globo.
 */
function balloonMask(
  balloon: Point[],
  x0: number,
  y0: number,
  w: number,
  h: number,
): Uint8Array {
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      mask[y * w + x] = contains(balloon, x0 + x + 0.5, y0 + y + 0.5) ? 1 : 0;
    }
  }
  return erode(mask, w, h, INSET);
}

/** El interior de varios globos juntos, cada uno metido hacia adentro por su cuenta. */
function union(balloons: Point[][], x0: number, y0: number, w: number, h: number): Uint8Array {
  const mask = new Uint8Array(w * h);
  for (const balloon of balloons) {
    const one = balloonMask(balloon, x0, y0, w, h);
    for (let p = 0; p < mask.length; p++) mask[p] |= one[p];
  }
  return mask;
}

/**
 * Levanta el texto de la página y devuelve su sprite.
 *
 * `ctx` es la página completa y se modifica: donde estaba el texto queda el tono del papel.
 * `balloons` son las siluetas de los globos, que marcan dónde se puede borrar tranquilo.
 */
export async function lift(
  ctx: OffscreenCanvasRenderingContext2D,
  text: Detection,
  pageArea: number,
  balloons: Point[][] = [],
): Promise<Sprite | null> {
  const { x, y, w, h } = text.bbox;
  if (w * h > MAX_TEXT_AREA_RATIO * pageArea) return null; // es dibujo, no diálogo

  // Se trabaja con bastante aire alrededor de la caja, no porque haya que borrar tanto sino
  // para ver las letras enteras: la caja del detector recorta, y una letra que la cruza tiene
  // que poder seguirse hasta donde termina.
  const x0 = Math.max(0, Math.floor(x) - MARGIN);
  const y0 = Math.max(0, Math.floor(y) - MARGIN);
  const cw = Math.min(ctx.canvas.width - x0, Math.ceil(w) + (Math.floor(x) - x0) + MARGIN);
  const ch = Math.min(ctx.canvas.height - y0, Math.ceil(h) + (Math.floor(y) - y0) + MARGIN);
  if (cw < 3 || ch < 3) return null;

  const region = ctx.getImageData(x0, y0, cw, ch);
  const px = region.data;
  const count = cw * ch;

  const levels = new Uint8Array(count);
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    levels[p] = Math.max(px[i], px[i + 1], px[i + 2]);
  }

  // Los filtros miran solo lo que el detector marcó. El aire de alrededor está para seguir
  // los trazos, no para opinar sobre si esto es diálogo.
  const seed = {
    x: Math.floor(x) - x0,
    y: Math.floor(y) - y0,
    w: Math.min(Math.ceil(w), cw),
    h: Math.min(Math.ceil(h), ch),
  };
  const core = crop(levels, cw, seed);
  if (!isSafeToLift(core)) return null;

  // El papel del bloque: percentil alto, no la media, que estaría ensuciada por las letras.
  const sorted = Uint8Array.from(core).sort();
  const paper = sorted[Math.floor(core.length * 0.85)];

  // El alfa sale de la tinta, así el sprite son las letras y no un recuadro blanco.
  const alpha = new Uint8Array(count);
  for (let p = 0; p < count; p++) {
    alpha[p] = Math.max(0, Math.min(255, ((paper - levels[p]) * 255) / Math.max(paper, 1)));
  }
  const inked = crop(alpha, cw, seed);
  let ink = 0;
  for (const a of inked) if (a > 40) ink++;
  if (ink / inked.length < 0.005) return null;
  if (!looksLikeText(inked, seed.w, seed.h)) return null;

  // Los colores de antes de borrar, que son los que se lleva el sprite: `erase` los pisa con
  // el papel, y leerlos después dejaba el diálogo escrito en blanco sobre el globo blanco.
  const before = new Uint8ClampedArray(px);

  // El globo que aloja a este texto, si hay alguno: adentro se borra sin reparos.
  // Si hay globos encimados —dos que se tocan, uno delante del otro—, el texto puede caer
  // entre los dos, así que el interior es la unión de todos los que lo tocan.
  const hosts = balloons.filter((polygon) => insidePolygon(polygon, text.bbox) > 0);
  const inside = hosts.length ? union(hosts, x0, y0, cw, ch) : undefined;
  const cover = erase(px, alpha, cw, ch, paper, inside, seed);
  ctx.putImageData(region, x0, y0);

  const { data, taken } = spriteOf(before, alpha, cover, cw, ch);
  if (!taken) return null;

  const image = new ImageData(cw, ch);
  image.data.set(data);

  return { image, rect: { x: x0, y: y0, w: cw, h: ch }, ink: taken / count };
}

/**
 * Arma el sprite con exactamente lo que se borró, en su color de antes.
 *
 * `before` tiene que ser el arte previo al borrado. Leer los píxeles ya borrados da un sprite
 * del color del papel: el diálogo aparece igual, pero escrito en blanco sobre el globo blanco
 * y no se ve nada. Que lo que desaparece del arte sea lo mismo que vuelve al revelarse es lo
 * que mantiene honesta a las dos mitades.
 */
export function spriteOf(
  before: Uint8ClampedArray,
  alpha: Uint8Array,
  cover: Float32Array,
  w: number,
  h: number,
): { data: Uint8ClampedArray; taken: number } {
  const data = new Uint8ClampedArray(w * h * 4);
  let taken = 0;
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    const a = Math.round(alpha[p] * cover[p]);
    data[i] = before[i];
    data[i + 1] = before[i + 1];
    data[i + 2] = before[i + 2];
    data[i + 3] = a;
    if (a > 40) taken++;
  }
  return { data, taken };
}

/** Recorta un plano de la región, para mirar solo lo que el detector marcó. */
function crop(src: Uint8Array, w: number, rect: Rect): Uint8Array {
  const out = new Uint8Array(rect.w * rect.h);
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      out[y * rect.w + x] = src[(rect.y + y) * w + rect.x + x];
    }
  }
  return out;
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

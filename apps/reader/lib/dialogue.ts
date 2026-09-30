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
/** Una mancha que llena así su caja, y casi cuadrada, es un punto. */
const DOT_FILL = 0.6;
const DOT_ASPECT = 0.7;
/** Con más de esta fracción de la tinta en motas sueltas, es trama y no texto. */
const MAX_SPECK_SHARE = 0.08;
/** Con más de esta fracción de puntos, es trama y no texto. */
const MAX_DOT_SHARE = 0.5;
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

  // Una trama fina —el gris de puntitos de un fondo— deja buena parte de la tinta en motas
  // de pocos píxeles. Las letras casi nada: medido en diálogos reales, como mucho el 0,4 %;
  // en una trama detrás de unas llamas, el 26 %.
  let specks = 0;
  for (const s of stats) if (s.area < 6) specks += s.area;
  if (specks / total > MAX_SPECK_SHARE) return false;

  const blobs = stats.filter((s) => s.area >= 6);
  const areas = blobs.map((s) => s.area);
  if (areas.length < MIN_BLOBS) return false;
  if (Math.max(...areas) / total > MAX_BLOB_SHARE) return false;

  // Una trama de puntos gruesos —el relleno de una onomatopeya— también reparte la tinta en
  // muchas manchas, pero casi todas son puntos redondos y macizos. Las letras no: son trazos
  // largos, curvas, anillos. Medido en páginas reales, en una trama el 68 % de las manchas
  // son puntos; en diálogos, entre el 11 y el 31 %.
  let dots = 0;
  for (const b of blobs) {
    const bw = b.maxX - b.minX + 1;
    const bh = b.maxY - b.minY + 1;
    if (b.area / (bw * bh) > DOT_FILL && Math.min(bw, bh) / Math.max(bw, bh) > DOT_ASPECT) dots++;
  }
  return dots / blobs.length < MAX_DOT_SHARE;
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
/** Hasta dónde, fuera de la caja del detector, se sigue buscando letras: fracción de la caja. */
const NEAR_SEED = 0.5;
/** Una mancha más chica que esto, en píxeles, es un punto de trama y no una letra. */
const MIN_LETTER_AREA = 12;
/** Y tampoco una mucho más chica que la letra típica del texto. */
const LETTER_SHARE = 0.3;

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
  paper: number | Rgb,
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
    //
    // Adentro del globo no hace falta que la caja la haya tocado: el modelo corta seguido la
    // caja —más con dos globos encimados, que ve como uno— y las letras de afuera quedaban a
    // la vista. Lo que está en el globo y tiene forma de letra se va con el resto.
    //
    // Pero solo cerca de la caja, y solo lo que tiene tamaño de letra: un globo grande —un
    // estallido— puede abarcar media viñeta, y los puntos de una trama dentro de él pasaban
    // por letras sueltas y se borraban en bloque, dejando un rectángulo blanco en el dibujo.
    const near = new Uint8Array(stats.length + 1);
    if (seed) {
      const padX = Math.round(seed.w * NEAR_SEED);
      const padY = Math.round(seed.h * NEAR_SEED);
      const x0 = Math.max(0, seed.x - padX);
      const y0 = Math.max(0, seed.y - padY);
      const x1 = Math.min(w, seed.x + seed.w + padX);
      const y1 = Math.min(h, seed.y + seed.h + padY);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) near[labels[y * w + x]] = 1;
    } else {
      near.fill(1);
    }
    // El tamaño de letra se toma de las que la caja sí tocó: los puntos de una trama son
    // mucho más chicos, a cualquier resolución.
    const letterAreas = stats
      .filter((st) => touched[st.label] && contacts[st.label] / border <= EDGE_SHARE && st.area >= 6)
      .map((st) => st.area)
      .sort((a, b) => a - b);
    const typical = letterAreas.length ? letterAreas[letterAreas.length >> 1] : 0;
    const minArea = Math.max(MIN_LETTER_AREA, typical * LETTER_SHARE);
    for (const stat of stats) {
      const label = stat.label;
      const reached = touched[label] || (within[label] > 0 && near[label] && stat.area >= minArea);
      const letter = contacts[label] / border <= EDGE_SHARE && within[label] >= stat.area * INSIDE_SHARE;
      isLetter[label] = reached && letter ? 1 : 0;
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
  //
  // Lo mismo en un cuadro de color —un recuadro naranja con letra blanca, uno negro—: el
  // hueco se tapa con el color del cuadro.
  const flat: Rgb | null =
    typeof paper !== "number" ? paper : paper >= PAPER_LEVEL ? [paper, paper, paper] : null;
  if (flat) {
    for (let p = 0, i = 0; p < count; p++, i += 4) {
      const a = cover[p];
      if (a <= 0) continue;
      px[i] = px[i] * (1 - a) + flat[0] * a;
      px[i + 1] = px[i + 1] * (1 - a) + flat[1] * a;
      px[i + 2] = px[i + 2] * (1 - a) + flat[2] * a;
    }
    return cover;
  }
  const level = paper as number;

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
      const around = total > 0.002 ? channels[c][p] / total : level;
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
  maxArea = MAX_TEXT_AREA_RATIO,
): Promise<Sprite | null> {
  const { x, y, w, h } = text.bbox;
  if (w * h > maxArea * pageArea) return null; // es dibujo, no diálogo

  // Los globos que tocan el texto. Si hay globos encimados —dos que se tocan, uno delante del
  // otro—, el texto puede caer entre los dos, así que el interior es la unión de todos.
  const hosts = balloons.filter((polygon) => insidePolygon(polygon, text.bbox) > 0);

  // Se trabaja con bastante aire alrededor de la caja, no porque haya que borrar tanto sino
  // para ver las letras enteras: la caja del detector recorta, y una letra que la cruza tiene
  // que poder seguirse hasta donde termina. Con globo, la región lo abarca entero: el texto
  // que la caja dejó afuera también es de ese globo.
  let left = x;
  let top = y;
  let right = x + w;
  let bottom = y + h;
  for (const polygon of hosts) {
    for (const [px, py] of polygon) {
      left = Math.min(left, px);
      top = Math.min(top, py);
      right = Math.max(right, px);
      bottom = Math.max(bottom, py);
    }
  }
  const x0 = Math.max(0, Math.floor(left) - MARGIN);
  const y0 = Math.max(0, Math.floor(top) - MARGIN);
  const cw = Math.min(ctx.canvas.width - x0, Math.ceil(right) - x0 + MARGIN);
  const ch = Math.min(ctx.canvas.height - y0, Math.ceil(bottom) - y0 + MARGIN);
  if (cw < 3 || ch < 3) return null;

  const region = ctx.getImageData(x0, y0, cw, ch);
  const px = region.data;
  const count = cw * ch;

  // Los filtros miran solo lo que el detector marcó. El aire de alrededor está para seguir
  // los trazos, no para opinar sobre si esto es diálogo.
  const seed = {
    x: Math.floor(x) - x0,
    y: Math.floor(y) - y0,
    w: Math.min(Math.ceil(w), cw),
    h: Math.min(Math.ceil(h), ch),
  };
  const measured = inkOf(px, cw, ch, seed);
  if (!measured) return null;
  const { alpha, paper } = measured;

  // Los colores de antes de borrar, que son los que se lleva el sprite: `erase` los pisa con
  // el papel, y leerlos después dejaba el diálogo escrito en blanco sobre el globo blanco.
  const before = new Uint8ClampedArray(px);

  // El globo que aloja a este texto, si hay alguno: adentro se borra sin reparos.
  const inside = hosts.length ? union(hosts, x0, y0, cw, ch) : undefined;
  const cover = erase(px, alpha, cw, ch, paper, inside, seed);
  ctx.putImageData(region, x0, y0);

  const { data, taken } = spriteOf(before, alpha, cover, cw, ch);
  if (!taken) return null;

  const image = new ImageData(cw, ch);
  image.data.set(data);

  return { image, rect: { x: x0, y: y0, w: cw, h: ch }, ink: taken / count };
}

type Rgb = [number, number, number];

/** Qué tan lejos tiene que estar un color del fondo para empezar a contar como tinta. */
const COLOR_INK_FROM = 40;
/** Y desde qué distancia es tinta plena. */
const COLOR_INK_FULL = 140;
/** Qué parte del bloque tiene que ser del color del fondo para tomarlo como un cuadro liso. */
const MIN_FLAT_RATIO = 0.3;

/**
 * La tinta del bloque, como alfa, y con qué se tapa el hueco.
 *
 * Lo común es letra oscura sobre papel claro, y ahí manda el brillo: la tinta es lo que se
 * aparta del papel hacia el negro. Pero hay cuadros de color —naranja con letra blanca, negro
 * con letra blanca— donde eso no ve nada, porque la letra es más clara que el fondo; ahí la
 * tinta es lo que se aparta del color del cuadro, hacia donde sea.
 */
export function inkOf(
  px: Uint8ClampedArray,
  w: number,
  h: number,
  seed: Rect,
): { alpha: Uint8Array; paper: number | Rgb } | null {
  // El orden importa, porque cualquiera de las dos puede dar un falso positivo. Por brillo,
  // un globo rosa cuenta como papel y los pedazos de cielo que entran en la caja pasan por
  // letras, mientras la letra blanca queda sin ver. Por color, un degradé de blanco a rojo
  // se aparta entero del "fondo" y parece tinta. Decide el borde de la caja: si es casi todo
  // de un mismo color que no es papel, es un cuadro de color y va primero por color.
  const byLight = () => inkByLight(px, w, h, seed);
  const byColor = () => inkByColor(px, w, h, seed);
  const order = isColoredBox(px, w, seed) ? [byColor, byLight] : [byLight, byColor];
  for (const measure of order) {
    const found = measure();
    if (found && readable(found.alpha, w, seed)) return found;
  }
  return null;
}

/** Qué parte del borde tiene que ser del mismo color para tomarlo como un cuadro liso. */
const FLAT_RING = 0.6;

/** ¿El borde de la caja es casi todo de un mismo color, y ese color no es papel? */
function isColoredBox(px: Uint8ClampedArray, w: number, seed: Rect): boolean {
  const bg = backdrop(px, w, seed);
  const paperLike = Math.min(...bg) >= PAPER_LEVEL - 15 && Math.max(...bg) - Math.min(...bg) <= 40;
  if (paperLike) return false;
  let near = 0;
  let total = 0;
  forRing(seed, (x, y) => {
    const i = (y * w + x) * 4;
    total++;
    if (Math.hypot(px[i] - bg[0], px[i + 1] - bg[1], px[i + 2] - bg[2]) < COLOR_INK_FROM) near++;
  });
  return total > 0 && near / total >= FLAT_RING;
}

/** Recorre el borde de la caja, cada píxel una vez. */
function forRing(seed: Rect, visit: (x: number, y: number) => void): void {
  const x1 = seed.x + seed.w - 1;
  const y1 = seed.y + seed.h - 1;
  for (let x = seed.x; x <= x1; x++) {
    visit(x, seed.y);
    if (y1 !== seed.y) visit(x, y1);
  }
  for (let y = seed.y + 1; y < y1; y++) {
    visit(seed.x, y);
    if (x1 !== seed.x) visit(x1, y);
  }
}

/** ¿Hay tinta, y está repartida como letras? */
function readable(alpha: Uint8Array, w: number, seed: Rect): boolean {
  const inked = crop(alpha, w, seed);
  let ink = 0;
  for (const a of inked) if (a > 40) ink++;
  return ink / inked.length >= 0.005 && looksLikeText(inked, seed.w, seed.h);
}

/** Tinta como lo que se aparta del papel hacia el negro. */
function inkByLight(px: Uint8ClampedArray, w: number, h: number, seed: Rect) {
  const count = w * h;
  const levels = new Uint8Array(count);
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    levels[p] = Math.max(px[i], px[i + 1], px[i + 2]);
  }
  const core = crop(levels, w, seed);
  if (!isSafeToLift(core)) return null;

  // El papel del bloque: percentil alto, no la media, que estaría ensuciada por las letras.
  const sorted = Uint8Array.from(core).sort();
  const paper = sorted[Math.floor(core.length * 0.85)];

  // El alfa sale de la tinta, así el sprite son las letras y no un recuadro blanco.
  const alpha = new Uint8Array(count);
  for (let p = 0; p < count; p++) {
    alpha[p] = Math.max(0, Math.min(255, ((paper - levels[p]) * 255) / Math.max(paper, 1)));
  }
  return { alpha, paper };
}

/** Tinta como lo que se aparta del color del cuadro, hacia donde sea. */
function inkByColor(px: Uint8ClampedArray, w: number, h: number, seed: Rect) {
  const count = w * h;
  const bg = backdrop(px, w, seed);
  const alpha = new Uint8Array(count);
  for (let i = 0, p = 0; p < count; i += 4, p++) {
    const d = Math.hypot(px[i] - bg[0], px[i + 1] - bg[1], px[i + 2] - bg[2]);
    alpha[p] = Math.max(0, Math.min(255, ((d - COLOR_INK_FROM) * 255) / (COLOR_INK_FULL - COLOR_INK_FROM)));
  }
  let flat = 0;
  for (const a of crop(alpha, w, seed)) if (a === 0) flat++;
  if (flat / (seed.w * seed.h) < MIN_FLAT_RATIO) return null;
  return { alpha, paper: bg };
}

/**
 * El color del fondo del bloque: la mediana de su borde.
 *
 * El borde de la caja cae casi todo en el fondo, entre letra y letra. El color más frecuente
 * del bloque entero parecía más natural y fallaba justo en los cuadros de color: la letra
 * blanca gruesa es un solo tono, mientras que el naranja escaneado se reparte en muchos, y
 * el "fondo" salía blanco.
 */
function backdrop(px: Uint8ClampedArray, w: number, seed: Rect): Rgb {
  const ring: number[][] = [[], [], []];
  const take = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) ring[c].push(px[i + c]);
  };
  forRing(seed, take);
  const median = (values: number[]) => values.sort((m, n) => m - n)[values.length >> 1] ?? 255;
  return [median(ring[0]), median(ring[1]), median(ring[2])];
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

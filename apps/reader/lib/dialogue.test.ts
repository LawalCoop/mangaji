import { describe, expect, it } from "vitest";
import { erase, spriteOf } from "./dialogue";

/**
 * Un bloque de papel con letras encima, como el interior de un globo.
 *
 * Devuelve los píxeles y el alfa de la tinta, que es lo que `lift` calcula antes de borrar.
 */
function block(w: number, h: number, strokes: [number, number, number, number][]) {
  const px = new Uint8ClampedArray(w * h * 4).fill(255);
  const ink = new Uint8Array(w * h);

  const paint = (x: number, y: number, level: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    if (px[i] <= level) return;
    px[i] = px[i + 1] = px[i + 2] = level;
  };

  for (const [x0, y0, sw, sh] of strokes) {
    // El halo del trazo, que es lo que trae cualquier texto escaneado: dos anillos de gris
    // antes del negro. Sin esto el borrado parece perfecto y en una página real deja el
    // contorno de cada letra dibujado.
    for (let y = y0 - 2; y < y0 + sh + 2; y++) {
      for (let x = x0 - 2; x < x0 + sw + 2; x++) paint(x, y, 205);
    }
    for (let y = y0 - 1; y < y0 + sh + 1; y++) {
      for (let x = x0 - 1; x < x0 + sw + 1; x++) paint(x, y, 120);
    }
    for (let y = y0; y < y0 + sh; y++) {
      for (let x = x0; x < x0 + sw; x++) {
        ink[y * w + x] = 1;
        paint(x, y, 0);
      }
    }
  }

  // El mismo alfa que arma `lift`: cuánto se aparta cada píxel del tono del papel.
  const alpha = new Uint8Array(w * h);
  for (let p = 0; p < alpha.length; p++) {
    const level = px[p * 4];
    alpha[p] = 255 - level;
  }
  return { px, alpha, ink };
}

const darkest = (px: Uint8ClampedArray) => {
  let min = 255;
  for (let i = 0; i < px.length; i += 4) min = Math.min(min, px[i]);
  return min;
};

describe("borrado del diálogo", () => {
  it("no deja rastro de las letras sobre el papel del globo", () => {
    const w = 40;
    const h = 40;
    // Cuatro trazos gruesos, del calibre de una letra de diálogo.
    const { px, alpha } = block(w, h, [
      [8, 10, 4, 12],
      [16, 10, 4, 12],
      [24, 10, 4, 12],
      [8, 26, 20, 4],
    ]);

    erase(px, alpha, w, h, 255);

    // Si quedara el fantasma, los píxeles donde estaban los trazos seguirían oscuros.
    expect(darkest(px)).toBeGreaterThan(245);
  });

  it("dentro del globo borra también las letras pegadas al borde del bloque", () => {
    const w = 40;
    const h = 40;
    // Una letra que llega hasta el borde: pasa cuando la caja del texto queda justa, y es lo
    // que dejaba pedazos de palabra sin borrar.
    const { px, alpha } = block(w, h, [
      [0, 14, 5, 12],
      [16, 14, 5, 12],
    ]);
    const inside = new Uint8Array(w * h).fill(1);

    erase(px, alpha, w, h, 255, inside);

    expect(darkest(px)).toBeGreaterThan(245);
  });

  it("sin globo detectado también borra la letra pegada al borde de un bloque chico", () => {
    // Un globo de dos palabras deja un bloque tan ajustado que cada letra ocupa una parte
    // grande: no pasa por chica, y lo que la salva es rozar el borde apenas de un lado.
    const w = 30;
    const h = 20;
    const { px, alpha } = block(w, h, [[0, 3, 6, 14]]);

    erase(px, alpha, w, h, 255);

    expect(darkest(px)).toBeGreaterThan(245);
  });

  it("deja papel liso junto al dibujo, sin el velo gris del promedio", () => {
    const w = 40;
    const h = 40;
    // Un trazo pegado a una masa de dibujo: al taparlo con el promedio de lo que lo rodea, la
    // masa oscura teñía el relleno y dejaba una sombra gris dentro del globo.
    const { px, alpha } = block(w, h, [[22, 10, 5, 20]]);
    for (let y = 0; y < h; y++) {
      for (let x = 30; x < w; x++) {
        const i = (y * w + x) * 4;
        px[i] = px[i + 1] = px[i + 2] = 20;
        alpha[y * w + x] = 235;
      }
    }

    erase(px, alpha, w, h, 255);

    // Donde estaba el trazo tiene que haber quedado papel, no un gris a medio camino.
    for (let y = 12; y < 28; y++) {
      for (let x = 22; x < 27; x++) expect(px[(y * w + x) * 4]).toBeGreaterThan(245);
    }
  });

  it("borra la letra entera aunque la caja del detector la corte por abajo", () => {
    const w = 40;
    const h = 40;
    // La caja marcada llega hasta y=20, pero las letras siguen hasta y=30. Recortando por la
    // caja quedaban las patas: eso es lo que se veía como guiones sueltos dentro del globo.
    const { px, alpha } = block(w, h, [
      [10, 8, 5, 22], // entra en la caja y sigue bastante más abajo
      [32, 30, 5, 8], // no la toca: es otra cosa y no se toca
    ]);
    const seed = { x: 6, y: 4, w: 16, h: 16 };

    erase(px, alpha, w, h, 255, undefined, seed);

    // La letra se fue entera, incluida la parte que caía fuera de la caja.
    for (let y = 8; y < 30; y++) {
      for (let x = 10; x < 15; x++) expect(px[(y * w + x) * 4]).toBeGreaterThan(245);
    }
    // Y lo que nunca entró en la caja sigue donde estaba.
    expect(px[(33 * w + 33) * 4]).toBeLessThan(60);
  });

  it("dentro del globo tampoco borra el dibujo que la caja no marcó", () => {
    const w = 40;
    const h = 40;
    // El globo detectado abarca de más y se come una franja de dibujo. Si lo de adentro se
    // borra por estar adentro, esa franja se blanquea y reaparece el corte cuadrado.
    const { px, alpha } = block(w, h, [[10, 10, 5, 10]]);
    for (let y = 0; y < h; y++) {
      for (let x = 30; x < w; x++) {
        const i = (y * w + x) * 4;
        px[i] = px[i + 1] = px[i + 2] = 30;
        alpha[y * w + x] = 225;
      }
    }
    const inside = new Uint8Array(w * h).fill(1);
    const seed = { x: 6, y: 6, w: 14, h: 18 };

    erase(px, alpha, w, h, 255, inside, seed);

    // La letra se fue…
    expect(px[(14 * w + 12) * 4]).toBeGreaterThan(245);
    // …y la franja de dibujo sigue intacta.
    expect(px[(20 * w + 34) * 4]).toBeLessThan(70);
  });

  it("el sprite se lleva la tinta original, no el papel que quedó en su lugar", () => {
    const w = 40;
    const h = 40;
    const { px, alpha } = block(w, h, [[14, 14, 6, 12]]);
    const before = new Uint8ClampedArray(px);

    const cover = erase(px, alpha, w, h, 255);
    const { data, taken } = spriteOf(before, alpha, cover, w, h);

    expect(taken).toBeGreaterThan(0);
    // Donde estaba el trazo, el sprite tiene que traer tinta oscura y opaca. Armándolo con
    // los píxeles de después del borrado quedaba blanco sobre blanco: invisible al revelarse.
    const at = (x: number, y: number) => (y * w + x) * 4;
    expect(data[at(16, 18)]).toBeLessThan(60);
    expect(data[at(16, 18) + 3]).toBeGreaterThan(200);
  });

  it("no borra el dibujo que entra por el borde del bloque", () => {
    const w = 40;
    const h = 40;
    const { px, alpha } = block(w, h, [[16, 16, 6, 6]]);

    // Dibujo que viene de afuera y cruza el bloque: es lo que la caja del texto se llevaba
    // puesto, dejando el rectángulo blanco.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < 6; x++) {
        const i = (y * w + x) * 4;
        px[i] = px[i + 1] = px[i + 2] = 40;
        alpha[y * w + x] = 215;
      }
    }

    erase(px, alpha, w, h, 255);

    const sample = (px[(20 * w + 2) * 4] + px[(30 * w + 3) * 4]) / 2;
    expect(sample).toBeLessThan(80);
  });

  it("no toca el papel que rodea al texto, así no aparece el borde de un bloque", () => {
    const w = 40;
    const h = 40;
    const { px, alpha } = block(w, h, [[16, 16, 6, 6]]);

    // Una franja de papel con su tono propio, del lado opuesto al texto.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < 4; x++) {
        const i = (y * w + x) * 4;
        px[i] = px[i + 1] = px[i + 2] = 250;
      }
    }
    const before = px.slice();

    erase(px, alpha, w, h, 255);

    // Rellenar el rectángulo entero pisaba esta franja y dejaba el corte a la vista.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < 4; x++) {
        const i = (y * w + x) * 4;
        expect(px[i]).toBe(before[i]);
      }
    }
  });
});

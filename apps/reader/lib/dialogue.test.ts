import { describe, expect, it } from "vitest";
import { erase, inkOf, spriteOf } from "./dialogue";

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

  it("dentro del globo no blanquea el fondo gris pegado al contorno", () => {
    const w = 40;
    const h = 40;
    // Un globo sobre un pasillo gris: el contorno toca la caja del texto y, por estar pegado
    // al gris, forma una sola mancha con todo el fondo. Eso dejaba un cuadro claro.
    const { px, alpha } = block(w, h, [[14, 14, 5, 10]]);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const edge = x < 8 || y < 8 || x >= 32 || y >= 32;
        const outline = x === 8 || y === 8 || x === 31 || y === 31;
        if (!edge && !outline) continue;
        const i = (y * w + x) * 4;
        const level = outline ? 20 : 170;
        px[i] = px[i + 1] = px[i + 2] = level;
        alpha[y * w + x] = Math.round(((255 - level) * 255) / 255);
      }
    }
    // La silueta del globo, metida hacia adentro: el contorno y el gris quedan afuera.
    const inside = new Uint8Array(w * h);
    for (let y = 11; y < 29; y++) for (let x = 11; x < 29; x++) inside[y * w + x] = 1;
    const seed = { x: 7, y: 7, w: 26, h: 26 };

    erase(px, alpha, w, h, 255, inside, seed);

    // La letra se fue…
    expect(px[(18 * w + 16) * 4]).toBeGreaterThan(245);
    // …y el gris de afuera y el contorno siguen donde estaban.
    expect(px[(3 * w + 3) * 4]).toBeLessThan(180);
    expect(px[(8 * w + 20) * 4]).toBeLessThan(60);
  });

  it("dentro del globo no se come el contorno que queda cerca del texto", () => {
    const w = 40;
    const h = 40;
    // Un tramo del contorno del globo dentro de la región, sin tocar su borde: por forma
    // pasaba por letra y el globo quedaba recortado.
    const { px, alpha } = block(w, h, [
      [16, 14, 5, 10],
      [30, 6, 2, 24],
    ]);
    // La silueta del globo, ya metida hacia adentro: el contorno queda afuera.
    const inside = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < 27; x++) inside[y * w + x] = 1;
    const seed = { x: 6, y: 4, w: 28, h: 30 };

    erase(px, alpha, w, h, 255, inside, seed);

    // La letra se fue…
    expect(px[(18 * w + 18) * 4]).toBeGreaterThan(245);
    // …y el contorno sigue entero.
    for (let y = 6; y < 30; y++) expect(px[(y * w + 30) * 4]).toBeLessThan(60);
  });

  it("dentro del globo borra entera la letra que se asoma fuera de la silueta", () => {
    const w = 40;
    const h = 40;
    // La silueta del modelo es aproximada: con dos globos encimados, parte del texto queda
    // fuera y esa letra no se borraba. Si está mayormente adentro, se va entera.
    const { px, alpha } = block(w, h, [[14, 10, 5, 20]]);
    const inside = new Uint8Array(w * h);
    for (let y = 0; y < 24; y++) for (let x = 0; x < w; x++) inside[y * w + x] = 1;
    const seed = { x: 6, y: 4, w: 28, h: 30 };

    erase(px, alpha, w, h, 255, inside, seed);

    expect(darkest(px)).toBeGreaterThan(245);
  });

  it("dentro del globo borra la línea que toca el contorno sin llevarse el contorno", () => {
    const w = 40;
    const h = 40;
    // El contorno a los costados y una línea de texto que lo toca de lado a lado: juntos son
    // una sola mancha y la línea quedaba a la vista.
    const { px, alpha } = block(w, h, [
      [4, 4, 2, 32],
      [34, 4, 2, 32],
      [6, 12, 28, 5],
    ]);
    const inside = new Uint8Array(w * h);
    for (let y = 4; y < 36; y++) for (let x = 9; x < 31; x++) inside[y * w + x] = 1;
    const seed = { x: 6, y: 10, w: 28, h: 10 };

    erase(px, alpha, w, h, 255, inside, seed);

    // La línea se fue en lo que cae dentro del globo…
    for (let x = 11; x < 29; x++) expect(px[(14 * w + x) * 4]).toBeGreaterThan(230);
    // …y el contorno sigue entero.
    for (let y = 4; y < 36; y++) expect(px[(y * w + 4) * 4]).toBeLessThan(60);
  });

  it("dentro del globo borra también las letras que la caja dejó afuera", () => {
    const w = 40;
    const h = 40;
    // La caja del detector cubre solo la mitad derecha del texto: con dos globos encimados
    // pasa seguido, y la otra mitad quedaba a la vista antes de tiempo.
    const { px, alpha } = block(w, h, [
      [8, 10, 4, 6],
      [8, 24, 4, 6],
      [24, 10, 4, 6],
    ]);
    const inside = new Uint8Array(w * h);
    for (let y = 4; y < 36; y++) for (let x = 4; x < 36; x++) inside[y * w + x] = 1;
    const seed = { x: 20, y: 6, w: 14, h: 12 };

    erase(px, alpha, w, h, 255, inside, seed);

    expect(darkest(px)).toBeGreaterThan(245);
  });

  it("en un cuadro de color levanta la letra clara y tapa con el color del cuadro", () => {
    const w = 40;
    const h = 40;
    // Un recuadro naranja con letra blanca: medido por brillo, la letra no es tinta.
    const orange = [230, 140, 100];
    const px = new Uint8ClampedArray(w * h * 4);
    for (let p = 0; p < w * h; p++) {
      px.set([...orange, 255], p * 4);
    }
    for (const [x0, y0] of [
      [8, 10],
      [20, 10],
      [8, 24],
      [20, 24],
    ]) {
      for (let y = y0; y < y0 + 8; y++) for (let x = x0; x < x0 + 5; x++) px.set([255, 255, 255, 255], (y * w + x) * 4);
    }
    const seed = { x: 4, y: 6, w: 32, h: 30 };

    const measured = inkOf(px, w, h, seed);
    expect(measured).not.toBeNull();
    const { alpha, paper } = measured!;
    expect(alpha[(12 * w + 10)]).toBeGreaterThan(200);
    expect(alpha[(3 * w + 3)]).toBe(0);

    erase(px, alpha, w, h, paper, undefined, seed);

    // Donde estaba la letra quedó naranja, no blanco ni gris.
    const i = (12 * w + 10) * 4;
    expect(Math.abs(px[i] - orange[0])).toBeLessThan(8);
    expect(Math.abs(px[i + 1] - orange[1])).toBeLessThan(8);
    expect(Math.abs(px[i + 2] - orange[2])).toBeLessThan(8);
  });

  it("levanta la letra roja sobre blanco", () => {
    // Medido por brillo —el canal más alto— el rojo puro es tan claro como el papel.
    const w = 40;
    const h = 40;
    const px = new Uint8ClampedArray(w * h * 4).fill(255);
    for (const [x0, y0] of [
      [8, 10],
      [20, 10],
      [8, 24],
      [20, 24],
    ]) {
      for (let y = y0; y < y0 + 8; y++) for (let x = x0; x < x0 + 4; x++) px.set([220, 20, 30, 255], (y * w + x) * 4);
    }
    const measured = inkOf(px, w, h, { x: 4, y: 6, w: 32, h: 30 });
    expect(measured).not.toBeNull();
    expect(measured!.alpha[12 * w + 10]).toBeGreaterThan(200);
  });

  it("levanta la letra oscura sobre un degradé de blanco a rojo", () => {
    // Medido por color, el degradé entero se aparta del "fondo" y parece tinta.
    const w = 40;
    const h = 40;
    const px = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = x / (w - 1);
        px.set([255, Math.round(255 * (1 - t)), Math.round(255 * (1 - t)), 255], (y * w + x) * 4);
      }
    }
    for (const [x0, y0] of [
      [8, 10],
      [20, 10],
      [8, 24],
      [20, 24],
    ]) {
      for (let y = y0; y < y0 + 8; y++) for (let x = x0; x < x0 + 4; x++) px.set([20, 20, 20, 255], (y * w + x) * 4);
    }
    const measured = inkOf(px, w, h, { x: 4, y: 6, w: 32, h: 30 });
    expect(measured).not.toBeNull();
    expect(measured!.alpha[12 * w + 10]).toBeGreaterThan(200);
    // El rojo del fondo no es tinta.
    expect(measured!.alpha[4 * w + 36]).toBeLessThan(40);
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

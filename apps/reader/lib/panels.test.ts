import { describe, expect, it } from "vitest";
import type { Detection } from "./detector";
import { choosePanels, fillOrphans, inkGrid, ownersOf } from "./panels";

const PAGE = 1000 * 1400;

function frame(conf: number, x: number, y: number, w: number, h: number): Detection {
  return {
    cls: "frame",
    conf,
    bbox: { x, y, w, h },
    polygon: [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
  };
}

describe("elección de viñetas", () => {
  // La página 15 del tomo 49 de Kingdom: tres viñetas seguras abajo y, arriba, una que
  // llega al borde de la hoja y el modelo solo ve con 0,11 de confianza.
  const bottom = [frame(0.97, 420, 1080, 580, 300), frame(0.97, 50, 740, 360, 640), frame(0.95, 420, 745, 580, 310)];

  it("rescata una viñeta dudosa y grande donde no hay ninguna segura", () => {
    const top = frame(0.11, 50, 0, 950, 730);
    const panels = choosePanels([...bottom, top], PAGE);
    expect(panels).toHaveLength(4);
    expect(panels).toContain(top);
  });

  it("no rescata una dudosa que repite una zona ya cubierta", () => {
    const ghost = frame(0.15, 420, 745, 580, 640);
    expect(choosePanels([...bottom, ghost], PAGE)).toHaveLength(3);
  });

  it("no rescata una dudosa chica: eso es un recorte, no una viñeta perdida", () => {
    const crumb = frame(0.2, 50, 0, 200, 200);
    expect(choosePanels([...bottom, crumb], PAGE)).toHaveLength(3);
  });

  it("no rescata dos veces la misma zona", () => {
    const a = frame(0.12, 50, 0, 950, 730);
    const b = frame(0.1, 60, 10, 930, 710);
    expect(choosePanels([...bottom, a, b], PAGE)).toHaveLength(4);
  });

  it("debajo del piso de confianza no se considera", () => {
    expect(choosePanels([...bottom, frame(0.05, 50, 0, 950, 730)], PAGE)).toHaveLength(3);
  });
});

describe("viñetas que el modelo no ve", () => {
  const W = 600;
  const H = 840;

  /** Una página RGBA blanca, con tinta en los rectángulos dados. */
  function page(inked: { x: number; y: number; w: number; h: number }[]) {
    const data = new Uint8ClampedArray(W * H * 4).fill(255);
    for (const r of inked) {
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          // Trama: un píxel de cada dos oscuro, como el sombreado de una viñeta.
          if ((x + y) % 2) data.set([0, 0, 0], (y * W + x) * 4);
        }
      }
    }
    return inkGrid(data, W, H);
  }

  const bottom = frame(0.97, 20, 440, 560, 380);

  it("una zona grande con dibujo y sin viñeta pasa a ser una", () => {
    const grid = page([{ x: 20, y: 20, w: 560, h: 400 }, { x: 20, y: 440, w: 560, h: 380 }]);
    const added = fillOrphans([bottom], [bottom], grid);
    expect(added).toHaveLength(1);
    expect(added[0].bbox.y).toBeLessThan(60);
    expect(added[0].bbox.h).toBeGreaterThan(320);
  });

  it("si el modelo propuso algo ahí, aunque sea con 4 %, se usa su forma", () => {
    const grid = page([{ x: 20, y: 20, w: 560, h: 400 }, { x: 20, y: 440, w: 560, h: 380 }]);
    const weak = frame(0.04, 15, 10, 570, 415);
    expect(fillOrphans([bottom], [bottom, weak], grid)).toEqual([weak]);
  });

  it("una calle fina con tinta no es una viñeta", () => {
    const grid = page([{ x: 20, y: 424, w: 560, h: 12 }, { x: 20, y: 440, w: 560, h: 380 }]);
    expect(fillOrphans([bottom], [bottom], grid)).toHaveLength(0);
  });

  it("sin ninguna viñeta no hace nada: ahí ya se usa la página entera", () => {
    const grid = page([{ x: 20, y: 20, w: 560, h: 800 }]);
    expect(fillOrphans([], [], grid)).toHaveLength(0);
  });
});

describe("a qué viñeta va cada texto", () => {
  it("va a la viñeta cuya silueta lo contiene", () => {
    const panels = [frame(0.9, 500, 0, 500, 1400), frame(0.9, 0, 0, 480, 300)];
    expect(ownersOf({ x: 100, y: 100, w: 80, h: 60 }, panels)).toEqual([1]);
  });

  it("sin silueta que lo contenga, va a la viñeta cuya caja lo toca, no a la primera", () => {
    // La viñeta de la izquierda tiene la silueta solo sobre el dibujo (x 200..480); el texto
    // está en su parte blanca. Antes caía en la primera de la lista: la larga de la derecha.
    const left = frame(0.8, 0, 0, 480, 300);
    left.polygon = [
      [200, 0],
      [480, 0],
      [480, 300],
      [200, 300],
    ];
    left.bbox = { x: 150, y: 0, w: 330, h: 300 };
    const panels = [frame(0.95, 500, 0, 500, 1400), left];
    expect(ownersOf({ x: 120, y: 100, w: 70, h: 60 }, panels)).toEqual([1]);
  });

  it("si ninguna caja lo toca, va a la más cercana", () => {
    const panels = [frame(0.95, 600, 0, 400, 1400), frame(0.8, 0, 0, 300, 300)];
    expect(ownersOf({ x: 320, y: 100, w: 40, h: 40 }, panels)).toEqual([1]);
  });
});

import { describe, expect, it } from "vitest";
import type { Detection } from "./detector";
import { choosePanels, fillAroundTexts, fillOrphans, inkGrid, isFolio, joinSplit, ownersOf, tailTip } from "./panels";

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

  it("una viñeta alta junto a una columna detectada también se rellena", () => {
    // La zona sin viñeta tiene forma de L —la viñeta alta de la derecha más el dibujo sobre
    // la columna—, y su caja pisaba la columna: se descartaba por eso (tomo 1, p. 46).
    const column = frame(0.97, 20, 100, 280, 700);
    const grid = page([
      { x: 300, y: 0, w: 280, h: 840 },
      { x: 150, y: 0, w: 150, h: 90 },
      { x: 20, y: 100, w: 280, h: 700 },
    ]);
    const added = fillOrphans([column], [column], grid);
    expect(added).toHaveLength(1);
    expect(added[0].bbox.x).toBeGreaterThanOrEqual(290);
  });

  it("usa el candidato flojo que marca dónde termina la zona", () => {
    // La zona abarca la viñeta de arriba y, unida por el dibujo que cruza la calle, la de
    // abajo. El modelo propone la de arriba con poca confianza: se usa, y la de abajo queda
    // libre (tomo 1, p. 31).
    const grid = page([{ x: 20, y: 20, w: 560, h: 800 }]);
    const weak = frame(0.03, 20, 20, 560, 560);
    const added = fillOrphans([frame(0.97, 700, 700, 10, 10)], [weak], grid);
    expect(added).toEqual([weak]);
  });

  it("corta en la calle dos viñetas unidas por un dibujo que la cruza", () => {
    // Un pelo que baja de una viñeta a la otra las une en una sola zona (Saint Seiya, p. 31).
    const grid = page([
      { x: 20, y: 20, w: 560, h: 400 },
      { x: 20, y: 450, w: 560, h: 370 },
      { x: 280, y: 420, w: 30, h: 30 },
    ]);
    const added = fillOrphans([frame(0.97, 590, 830, 5, 5)], [], grid);
    expect(added).toHaveLength(2);
    const top = added.find((a) => a.bbox.y < 100)!;
    expect(top.bbox.y + top.bbox.h).toBeLessThanOrEqual(460);
  });

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

  it("no comparte un texto entre una viñeta y un relleno encimado", () => {
    // La viñeta grande de una doble página, rellenada como rectángulo, se pasa sobre la de
    // al lado. El texto está entero en las dos: antes aparecía al leer la grande.
    const small = frame(0.95, 0, 900, 700, 700);
    const filler = frame(0, 480, 0, 1500, 1600);
    expect(ownersOf({ x: 500, y: 1000, w: 80, h: 90 }, [small, filler])).toEqual([0]);
  });

  it("comparte el globo que de verdad queda partido entre dos viñetas", () => {
    const panels = [frame(0.9, 0, 0, 500, 700), frame(0.9, 500, 0, 500, 700)];
    expect(ownersOf({ x: 440, y: 100, w: 120, h: 60 }, panels)).toEqual([0, 1]);
  });
});

describe("folio", () => {
  const panels = [frame(0.9, 50, 60, 900, 1240)];

  it("reconoce el número de página al pie, fuera de las viñetas", () => {
    expect(isFolio({ x: 60, y: 1330, w: 300, h: 30 }, panels, 1000, 1400)).toBe(true);
  });

  it("no toma por folio un diálogo dentro de una viñeta", () => {
    expect(isFolio({ x: 100, y: 1250, w: 200, h: 30 }, panels, 1000, 1400)).toBe(false);
  });

  it("no toma por folio un texto alto, aunque esté en el margen", () => {
    expect(isFolio({ x: 60, y: 1300, w: 200, h: 90 }, panels, 1000, 1400)).toBe(false);
  });
});

describe("relleno junto a viñetas detectadas", () => {
  it("no comparte un globo entre una viñeta detectada y un relleno", () => {
    const panels = [frame(0.96, 60, 300, 470, 280), frame(0, 430, 0, 600, 1300)];
    expect(ownersOf({ x: 343, y: 304, w: 188, h: 243 }, panels)).toEqual([0]);
  });
});

describe("viñeta alrededor de un texto suelto", () => {
  it("arma la viñeta con el hueco que rodea al texto", () => {
    // Una viñeta casi blanca abajo, con un texto, que ni el modelo ni la tinta ven.
    const panels = [frame(0.96, 0, 0, 1000, 1000)];
    const added = fillAroundTexts(panels, [{ x: 600, y: 1100, w: 200, h: 50 }], 1000, 1400);
    expect(added).toHaveLength(1);
    expect(added[0].bbox).toEqual({ x: 0, y: 1000, w: 1000, h: 400 });
  });

  it("no toca los textos que ya están en una viñeta", () => {
    const panels = [frame(0.96, 0, 0, 1000, 1400)];
    expect(fillAroundTexts(panels, [{ x: 600, y: 1100, w: 200, h: 50 }], 1000, 1400)).toHaveLength(0);
  });
});

describe("colita del globo", () => {
  /** Un globo redondo con la colita saliendo hacia abajo a la izquierda. */
  function balloon(): [number, number][] {
    const points: [number, number][] = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * 2 * Math.PI;
      const x = 500 + 100 * Math.cos(a);
      const y = 200 + 120 * Math.sin(a);
      points.push([x, y]);
      // Entre los ángulos de abajo a la izquierda, la colita.
      if (i === 17) points.push([400, 390]);
    }
    return points;
  }

  it("encuentra la punta de la colita", () => {
    const tip = tailTip(balloon())!;
    expect(Math.hypot(tip[0] - 400, tip[1] - 390)).toBeLessThan(25);
  });

  it("un globo partido entre dos viñetas es de la que señala la colita", () => {
    // El globo cruza la calle entre la viñeta de la izquierda y la de la derecha, que se lee
    // primero; la colita señala la izquierda (tomo 1, p. 15).
    const panels = [frame(0.88, 494, 5, 610, 1070), frame(0.97, 91, 96, 388, 493)];
    const box = { x: 377, y: 60, w: 196, h: 256 };
    expect(ownersOf(box, panels)).toHaveLength(2);
    expect(ownersOf(box, panels, [399, 309])).toEqual([1]);
  });
});

describe("viñeta vista partida en dos", () => {
  it("une las dos mitades de una viñeta alta (tomo 2 de Saint Seiya, p. 96b)", () => {
    const top = frame(0.95, 486, 7, 542, 1232);
    const bottom = frame(0.93, 485, 342, 540, 1272);
    const joined = joinSplit([top, bottom, frame(0.97, 82, 108, 397, 637)]);
    expect(joined).toHaveLength(2);
    expect(joined[0].bbox).toEqual({ x: 485, y: 7, w: 543, h: 1607 });
  });

  it("no une dos viñetas vecinas que apenas se tocan", () => {
    expect(joinSplit([frame(0.9, 0, 0, 500, 400), frame(0.9, 0, 380, 500, 400)])).toHaveLength(2);
  });

  it("no une dos viñetas separadas por un corte en diagonal (tomo 49 de Kingdom, p. 7)", () => {
    // Las cajas se pisan dos tercios de la de abajo; las siluetas, nada.
    const shape = (polygon: [number, number][]) => {
      const xs = polygon.map((p) => p[0]);
      const ys = polygon.map((p) => p[1]);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { cls: "frame" as const, conf: 0.95, polygon, bbox: { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y } };
    };
    const top = shape([[0, 0], [400, 0], [400, 500], [0, 700]]);
    const bottom = shape([[0, 710], [400, 510], [400, 800], [0, 800]]);
    expect(joinSplit([top, bottom])).toHaveLength(2);
  });

  it("no une dos viñetas angostas de una misma fila aunque sus cajas se pisen", () => {
    expect(joinSplit([frame(0.97, 270, 879, 297, 756), frame(0.96, 157, 873, 244, 767)])).toHaveLength(2);
  });
});

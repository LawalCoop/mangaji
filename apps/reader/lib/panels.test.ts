import { describe, expect, it } from "vitest";
import type { Detection } from "./detector";
import { choosePanels } from "./panels";

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

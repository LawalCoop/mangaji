import { describe, expect, it } from "vitest";
import { directedShot, HOLD } from "./directed";

const phone = { w: 390, h: 760 };
const frame = (rect: { x: number; y: number; w: number; h: number }, extra = {}) => ({
  rect,
  tension: 0.3,
  beats: [],
  ...extra,
});

describe("cámara β en el celular", () => {
  it("recorre de derecha a izquierda una viñeta ancha y termina mostrándola entera", () => {
    const rect = { x: 100, y: 200, w: 900, h: 300 };
    const shot = directedShot(frame(rect), phone);
    expect(shot.steps).toHaveLength(2);
    const [pan, whole] = shot.steps;
    // Arranca más cerca que la viñeta entera y mostrando el borde derecho…
    expect(shot.from.scale).toBeGreaterThan(whole.to.scale * 1.5);
    expect(shot.from.x + (rect.x + rect.w) * shot.from.scale).toBeLessThanOrEqual(phone.w);
    // …y el paneo va hacia la izquierda, a la misma escala.
    expect(pan.to.x).toBeGreaterThan(shot.from.x);
    expect(pan.to.scale).toBe(shot.from.scale);
  });

  it("recorre de arriba a abajo una viñeta alta en una pantalla ancha", () => {
    const shot = directedShot(frame({ x: 0, y: 0, w: 200, h: 1400 }), { w: 1200, h: 700 });
    expect(shot.steps).toHaveLength(2);
    expect(shot.steps[0].to.y).toBeLessThan(shot.from.y);
    expect(shot.steps[0].to.x).toBe(shot.from.x);
  });

  it("no panea una viñeta que entera no queda tan chica", () => {
    // Entera ocupa más de la mitad de lo que podría: se muestra sin recorrerla.
    expect(directedShot(frame({ x: 0, y: 0, w: 600, h: 500 }), phone).steps).toHaveLength(1);
  });

  it("con diálogo, va de globo en globo a medida que aparecen y al final se aleja", () => {
    const rect = { x: 0, y: 0, w: 1000, h: 300 };
    const shot = directedShot(
      frame(rect, {
        beats: [{ reveal: "b1" }, { reveal: "b2" }, { hold: 600 }],
        layers: [
          { id: "b1", rect: { x: 800, y: 20, w: 120, h: 80 } },
          { id: "b2", rect: { x: 300, y: 20, w: 120, h: 80 } },
        ],
      }),
      phone,
    );
    expect(shot.steps.map((s) => s.on)).toEqual(["b1", "b2", HOLD, HOLD]);
    // El segundo globo está más a la izquierda: la cámara sigue hacia allá.
    expect(shot.steps[1].to.x).toBeGreaterThan(shot.steps[0].to.x);
  });
});

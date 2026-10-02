import { describe, expect, it } from "vitest";
import { directedShot } from "./directed";

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
    const pan = shot.pan!;
    // Arranca más cerca que la viñeta entera y mostrando el borde derecho…
    expect(pan.start.scale).toBeGreaterThan(shot.final!.scale * 1.5);
    expect(pan.start.x + (rect.x + rect.w) * pan.start.scale).toBeLessThanOrEqual(phone.w);
    // …y va hacia la izquierda, a la misma escala, sin apuro.
    expect(pan.end.x).toBeGreaterThan(pan.start.x);
    expect(pan.end.scale).toBe(pan.start.scale);
    expect(pan.ms).toBeGreaterThanOrEqual(2500);
  });

  it("recorre de arriba a abajo una viñeta alta en una pantalla ancha", () => {
    const pan = directedShot(frame({ x: 0, y: 0, w: 200, h: 1400 }), { w: 1200, h: 700 }).pan!;
    expect(pan.end.y).toBeLessThan(pan.start.y);
    expect(pan.end.x).toBe(pan.start.x);
  });

  it("no panea una viñeta que entera no queda tan chica", () => {
    // Entera ocupa más de la mitad de lo que podría: se muestra sin recorrerla.
    expect(directedShot(frame({ x: 0, y: 0, w: 600, h: 500 }), phone).steps).toHaveLength(1);
  });

  it("con diálogo, no pasa un globo antes de que aparezca y dura lo que el diálogo", () => {
    const rect = { x: 0, y: 0, w: 1000, h: 300 };
    const pan = directedShot(
      frame(rect, {
        beats: [{ t: 450, reveal: "b1" }, { t: 2000, reveal: "b2" }, { t: 9000, hold: 600 }],
        layers: [
          { id: "b1", rect: { x: 800, y: 20, w: 120, h: 80 } },
          { id: "b2", rect: { x: 300, y: 20, w: 120, h: 80 } },
        ],
      }),
      phone,
    ).pan!;
    expect(pan.stops.map((s) => s.id)).toEqual(["b1", "b2"]);
    // El globo de la izquierda queda más adelante en el recorrido.
    expect(pan.stops[1].at).toBeGreaterThan(pan.stops[0].at);
    expect(pan.ms).toBeGreaterThanOrEqual(9000);
  });
});

import { describe, expect, it } from "vitest";
import { directedShot } from "./directed";

const phone = { w: 390, h: 760 };

describe("cámara β en el celular", () => {
  it("recorre de derecha a izquierda una viñeta ancha y termina mostrándola entera", () => {
    const rect = { x: 100, y: 200, w: 900, h: 300 };
    const shot = directedShot(0.3, rect, phone);
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
    const shot = directedShot(0.3, { x: 0, y: 0, w: 200, h: 1400 }, { w: 1200, h: 700 });
    expect(shot.steps).toHaveLength(2);
    expect(shot.steps[0].to.y).toBeLessThan(shot.from.y);
    expect(shot.steps[0].to.x).toBe(shot.from.x);
  });

  it("no panea una viñeta que entera ya se ve grande", () => {
    expect(directedShot(0.3, { x: 0, y: 0, w: 400, h: 760 }, phone).steps).toHaveLength(1);
  });
});

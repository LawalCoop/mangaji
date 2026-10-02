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
    expect(pan.ms).toBeGreaterThanOrEqual(2000);
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

describe("todo plano dice dónde termina", () => {
  it("también el que se recorre, que no tiene tramos", () => {
    // Faltaba en el paneo, y el lector, al buscar el final en los tramos, se caía.
    const shot = directedShot(frame({ x: 0, y: 0, w: 1000, h: 300 }), phone);
    expect(shot.steps).toHaveLength(0);
    expect(shot.final).toBeDefined();
    expect(directedShot(frame({ x: 0, y: 0, w: 400, h: 700 }), phone).final).toBeDefined();
  });
});

describe("viñetas grandes y casi cuadradas", () => {
  it("se recorren en diagonal, de arriba a la derecha a abajo a la izquierda", () => {
    // 1000×900 en un celular: entera se ve a 0,39 de su resolución.
    const shot = directedShot(frame({ x: 50, y: 50, w: 1000, h: 900 }), phone);
    const pan = shot.pan!;
    expect(pan.start.scale).toBeGreaterThan(shot.final.scale * 1.2);
    expect(pan.end.x).toBeGreaterThan(pan.start.x); // hacia la izquierda
    // A lo alto ya entra: se la centra y no se mueve en ese eje.
    expect(pan.end.y).toBe(pan.start.y);
  });

  it("si no entra a lo alto, también baja", () => {
    const pan = directedShot(frame({ x: 0, y: 0, w: 1000, h: 1300 }), phone).pan!;
    expect(pan.end.x).toBeGreaterThan(pan.start.x);
    expect(pan.end.y).toBeLessThan(pan.start.y);
  });

  it("en una pantalla grande, donde ya se aprecia, no se recorren", () => {
    expect(directedShot(frame({ x: 0, y: 0, w: 1000, h: 900 }), { w: 1600, h: 1000 }).pan).toBeUndefined();
  });
});

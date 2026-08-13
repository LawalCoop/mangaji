import { describe, expect, it } from "vitest";
import { readingOrder, type Box } from "./reading-order";
import type { Point } from "./vision";

/**
 * Los mismos casos que cubren el pipeline de Python, portados.
 *
 * No hace falta manga real: lo que se prueba es la topología de la página, y esa se escribe
 * a mano. Cada caso lleva las viñetas ya en orden, y el test las da vuelta antes de ordenar
 * para que el resultado no dependa de cómo venían.
 */

const W = 1000;

const box = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h });
const poly = (pts: [number, number][]): Point[] => pts;

function check(expected: Box[], rtl = true) {
  const shuffled = [...expected].reverse();
  const got = readingOrder(shuffled, { rtl });
  expect(got.map((i) => shuffled[i])).toEqual(expected);
}

describe("orden de lectura", () => {
  it("una sola viñeta", () => {
    expect(readingOrder([box(0, 0, W, 1500)])).toEqual([0]);
  });

  it("filas apiladas", () => {
    check([box(0, 0, W, 480), box(0, 500, W, 480), box(0, 1000, W, 480)]);
  });

  it("rejilla 2x2 de derecha a izquierda", () => {
    check([
      box(510, 0, 480, 700),
      box(0, 0, 480, 700),
      box(510, 720, 480, 700),
      box(0, 720, 480, 700),
    ]);
  });

  it("rejilla 2x2 occidental", () => {
    check(
      [box(0, 0, 480, 700), box(510, 0, 480, 700), box(0, 720, 480, 700), box(510, 720, 480, 700)],
      false,
    );
  });

  it("fila partida en columnas", () => {
    check([
      box(0, 0, W, 400),
      box(510, 420, 480, 500),
      box(0, 420, 480, 500),
      box(0, 940, W, 400),
    ]);
  });

  it("columna alta junto a dos bajas", () => {
    // El caso que rompe cualquier orden por coordenada: ordenar por `y` intercalaría la
    // alta entre las dos bajas.
    check([box(510, 0, 480, 1000), box(0, 0, 480, 480), box(0, 500, 480, 480)]);
  });

  it("escalonado de tres bandas", () => {
    check([
      box(0, 0, W, 300),
      box(660, 320, 330, 400),
      box(340, 320, 300, 400),
      box(0, 320, 320, 400),
      box(500, 740, 490, 600),
      box(0, 740, 480, 600),
    ]);
  });

  it("un gutter angosto no parte la banda", () => {
    const boxes = [box(510, 0, 480, 700), box(0, 4, 480, 700)];
    expect(readingOrder(boxes).map((i) => boxes[i])).toEqual(boxes);
  });

  it("el gutter diagonal separa dos viñetas de la misma fila", () => {
    // Sus cajas se pisan en ambos ejes; el pivote vertical las separa porque a cada
    // trapecio le recorta una esquina despreciable.
    const left = poly([
      [10, 520],
      [620, 520],
      [710, 990],
      [10, 990],
    ]);
    const right = poly([
      [640, 528],
      [1000, 528],
      [1000, 988],
      [730, 988],
    ]);
    const boxes = [box(10, 520, 700, 470), box(640, 528, 360, 460)];
    expect(readingOrder(boxes, { polygons: [left, right] })).toEqual([1, 0]);
  });

  it("banda diagonal seguida de otra fila", () => {
    const left = poly([
      [10, 0],
      [620, 0],
      [710, 470],
      [10, 470],
    ]);
    const right = poly([
      [640, 8],
      [1000, 8],
      [1000, 468],
      [730, 468],
    ]);
    const below = poly([
      [0, 500],
      [1000, 500],
      [1000, 900],
      [0, 900],
    ]);
    const boxes = [box(10, 0, 700, 470), box(640, 8, 360, 460), box(0, 500, W, 400)];
    expect(readingOrder(boxes, { polygons: [left, right, below] })).toEqual([1, 0, 2]);
  });

  it("las viñetas superpuestas no rompen el orden", () => {
    const boxes = [box(0, 0, 600, 600), box(300, 300, 600, 600)];
    expect(readingOrder(boxes).sort()).toEqual([0, 1]);
  });

  it("siempre devuelve una permutación", () => {
    const boxes = Array.from({ length: 16 }, (_, i) =>
      box((i % 4) * 260, Math.floor(i / 4) * 380, 240, 360),
    );
    for (const rtl of [true, false]) {
      expect([...readingOrder(boxes, { rtl })].sort((a, b) => a - b)).toEqual(
        Array.from({ length: 16 }, (_, i) => i),
      );
    }
  });
});

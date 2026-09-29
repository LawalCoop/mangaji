import { describe, expect, it } from "vitest";
import { boxBlur, components, convexHull, largestComponent, open, simplify, traceContour } from "./vision";

/** Dibuja una máscara a partir de un plano en texto: `#` es figura, `.` es fondo. */
function mask(rows: string[]) {
  const h = rows.length;
  const w = rows[0].length;
  const data = new Uint8Array(w * h);
  rows.forEach((row, y) => [...row].forEach((c, x) => (data[y * w + x] = c === "#" ? 1 : 0)));
  return { data, w, h };
}

const show = (data: Uint8Array, w: number, h: number) =>
  Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => (data[y * w + x] ? "#" : ".")).join(""),
  );

describe("apertura morfológica", () => {
  it("corta un hilo de un píxel entre dos cuerpos", () => {
    // Es el caso real: dos regiones unidas por un puente que al contornear cruza la viñeta.
    const { data, w, h } = mask([
      "........",
      ".###....",
      ".###....",
      "...#....", // el puente
      "....###.",
      "....###.",
      "........",
    ]);
    const out = open(data, w, h, 1);
    expect(show(out, w, h)[3]).toBe("........");
  });

  it("no borra una figura más gruesa que el radio", () => {
    const { data, w, h } = mask(["......", ".####.", ".####.", ".####.", "......"]);
    const out = open(data, w, h, 1);
    expect(out.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });
});

describe("componentes conexos", () => {
  it("separa regiones y mide su área", () => {
    const { data, w, h } = mask(["##...", "##...", ".....", "...##", "...##"]);
    const { stats } = components(data, w, h);
    expect(stats).toHaveLength(2);
    expect(stats.map((s) => s.area).sort()).toEqual([4, 4]);
  });

  it("une en diagonal, que es vecindad de 8", () => {
    const { data, w, h } = mask(["#..", ".#.", "..#"]);
    expect(components(data, w, h).stats).toHaveLength(1);
  });

  it("se queda con la región mayor", () => {
    const { data, w, h } = mask(["####.", "####.", ".....", "#....", "....."]);
    const out = largestComponent(data, w, h);
    expect(out[3 * w]).toBe(0); // el píxel suelto desaparece
    expect(out.reduce((a, b) => a + b, 0)).toBe(8);
  });
});

describe("trazado de contorno", () => {
  it("recorre el borde de un rectángulo", () => {
    const { data, w, h } = mask(["......", ".####.", ".#..#.", ".####.", "......"]);
    const contour = traceContour(data, w, h);
    // Los 10 píxeles del marco, sin repetir el de partida.
    expect(contour).toHaveLength(10);
    expect(contour[0]).toEqual([1, 1]);
    for (const [x, y] of contour) expect(data[y * w + x]).toBe(1);
  });

  it("devuelve vacío si no hay figura", () => {
    const { data, w, h } = mask(["...", "..."]);
    expect(traceContour(data, w, h)).toEqual([]);
  });
});

describe("simplificación", () => {
  it("reduce una recta a sus extremos", () => {
    const line: [number, number][] = Array.from({ length: 20 }, (_, i) => [i, 0]);
    expect(simplify(line, 1)).toEqual([
      [0, 0],
      [19, 0],
    ]);
  });

  it("conserva las esquinas de un rectángulo", () => {
    const rect: [number, number][] = [];
    for (let x = 0; x <= 20; x++) rect.push([x, 0]);
    for (let y = 1; y <= 10; y++) rect.push([20, y]);
    for (let x = 19; x >= 0; x--) rect.push([x, 10]);
    for (let y = 9; y >= 1; y--) rect.push([0, y]);

    const simple = simplify(rect, 2);
    expect(simple.length).toBeLessThanOrEqual(6);
    expect(simple).toContainEqual([20, 0]);
    expect(simple).toContainEqual([20, 10]);
  });

  it("no toca un polígono que ya es mínimo", () => {
    const tri: [number, number][] = [
      [0, 0],
      [10, 0],
      [5, 8],
    ];
    expect(simplify(tri, 2)).toHaveLength(3);
  });
});

describe("envolvente convexa", () => {
  it("descarta los puntos interiores", () => {
    const pts: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [5, 5],
      [3, 7],
    ];
    const hull = convexHull(pts);
    expect(hull).toHaveLength(4);
    expect(hull).not.toContainEqual([5, 5]);
  });
});

describe("desenfoque de caja", () => {
  it("no altera una superficie pareja", () => {
    const flat = new Float32Array(64).fill(7);
    boxBlur(flat, 8, 8, 3);
    for (const v of flat) expect(v).toBeCloseTo(7, 5);
  });

  it("reparte un punto aislado entre sus vecinos sin perder tinta", () => {
    const spot = new Float32Array(81);
    spot[40] = 81; // el centro de 9x9
    boxBlur(spot, 9, 9, 1);
    expect(spot[40]).toBeLessThan(81);
    expect(spot[40]).toBeGreaterThan(0);
    // El borde replica, así que la suma se conserva salvo por lo que se acumula afuera.
    expect(spot.reduce((a, b) => a + b, 0)).toBeCloseTo(81, 3);
  });
});

import { describe, expect, it } from "vitest";
import { maskToPolygon, onDark } from "./detector";

/** Generador determinista: los casos tienen que ser los mismos en cada corrida. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * Prototipos con la forma que dejan los del modelo: cero fuera de la caja y, adentro, una
 * figura con ruido, manchas sueltas y bordes difusos que ponen a prueba la apertura.
 */
function protos(sw: number, sh: number, cells: { x1: number; y1: number; x2: number; y2: number }, seed: number) {
  const rand = lcg(seed);
  const small = new Float32Array(sw * sh);
  for (let y = cells.y1; y < cells.y2; y++) {
    for (let x = cells.x1; x < cells.x2; x++) {
      const inner =
        x > cells.x1 + 1 && x < cells.x2 - 2 && y > cells.y1 + 1 && y < cells.y2 - 2 ? 0.75 : 0.3;
      small[y * sw + x] = Math.min(1, inner + (rand() - 0.5) * 0.6);
    }
  }
  return small;
}

describe("máscara a polígono", () => {
  const sw = 64;
  const sh = 90;
  const width = 1081;
  const height = 1573;

  type Cells = { x1: number; y1: number; x2: number; y2: number };
  const cases: { name: string; cells: Cells; empty?: boolean }[] = [
    { name: "en el medio de la página", cells: { x1: 12, y1: 20, x2: 40, y2: 55 } },
    { name: "pegada a la esquina superior izquierda", cells: { x1: 0, y1: 0, x2: 30, y2: 25 } },
    { name: "pegada a la esquina inferior derecha", cells: { x1: 40, y1: 60, x2: 64, y2: 90 } },
    // Tan fina que la apertura la borra: los dos caminos tienen que coincidir en no dar nada.
    { name: "de una sola celda de alto", cells: { x1: 5, y1: 44, x2: 50, y2: 45 }, empty: true },
    { name: "a lo ancho de toda la página", cells: { x1: 0, y1: 30, x2: 64, y2: 60 } },
  ];

  for (const { name, cells, empty } of cases) {
    it(`recortar a la caja da lo mismo que la página entera: ${name}`, () => {
      for (let seed = 1; seed <= 4; seed++) {
        const small = protos(sw, sh, cells, seed);
        const cropped = maskToPolygon(small, sw, sh, width, height, cells);
        expect(cropped).toEqual(maskToPolygon(small, sw, sh, width, height));
        // Que la igualdad no sea entre dos vacíos.
        if (!empty) expect(cropped?.length).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it("una caja sin nada por encima del umbral no da polígono", () => {
    const small = new Float32Array(sw * sh);
    expect(maskToPolygon(small, sw, sh, width, height, { x1: 10, y1: 10, x2: 20, y2: 20 })).toBeNull();
  });
});


function flatPage(w: number, h: number, level: (x: number, y: number) => number) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = level(x, y);
      data.set([v, v, v, 255], (y * w + x) * 4);
    }
  }
  return { data, width: w, height: h };
}

describe("texto de la pasada invertida", () => {
  it("acepta letra clara sobre una mancha negra", () => {
    const img = flatPage(60, 60, (x, y) => (x > 20 && x < 30 && y > 20 && y < 40 ? 255 : 0));
    expect(onDark(img, { x: 10, y: 10, w: 40, h: 40 })).toBe(true);
  });

  it("descarta un cielo negro salpicado de manchas claras", () => {
    // El borde cae en lo negro, pero la mitad de la caja es claro: rocas, no letras.
    const img = flatPage(60, 60, (x, y) => (x % 5 < 4 && x > 12 && x < 48 && y > 12 && y < 48 ? 255 : 0));
    expect(onDark(img, { x: 10, y: 10, w: 40, h: 40 })).toBe(false);
  });

  it("descarta una trama de puntos sobre blanco", () => {
    // En negativo parece texto, pero el fondo es claro: es dibujo.
    const img = flatPage(60, 60, (x, y) => (x % 3 === 0 && y % 3 === 0 ? 0 : 255));
    expect(onDark(img, { x: 10, y: 10, w: 40, h: 40 })).toBe(false);
  });
});

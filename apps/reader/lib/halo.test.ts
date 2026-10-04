import { describe, expect, it } from "vitest";
import { liftHalo } from "./halo";

/** Una región de w×h con fondo de trama gris (puntos sobre gris medio). */
function halftone(w: number, h: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = (x % 4 < 2) === (y % 4 < 2) ? 90 : 170;
      px[i] = px[i + 1] = px[i + 2] = v;
      px[i + 3] = 255;
    }
  }
  return px;
}

/** Pinta un rectángulo de un gris. */
function rect(px: Uint8ClampedArray, w: number, x0: number, y0: number, rw: number, rh: number, v: number) {
  for (let y = y0; y < y0 + rh; y++) {
    for (let x = x0; x < x0 + rw; x++) {
      const i = (y * w + x) * 4;
      px[i] = px[i + 1] = px[i + 2] = v;
    }
  }
}

describe("texto con halo", () => {
  const W = 260;
  const H = 200;
  const seed = { x: 70, y: 82, w: 120, h: 38 };

  it("levanta letras negras con halo blanco sobre una trama, y rellena con la trama", () => {
    const px = halftone(W, H);
    // Cinco "letras": barras negras de 6×24 px, cada una con 4 px de halo blanco.
    for (let k = 0; k < 5; k++) {
      const x = 80 + k * 20;
      rect(px, W, x - 4, 84, 14, 32, 255);
      rect(px, W, x, 88, 6, 24, 20);
    }
    const out = liftHalo(px, W, H, seed, 1500);
    expect(out).not.toBeNull();
    // La letra va al sprite y el hueco queda con la trama, no en blanco ni en negro.
    const p = 100 * W + 82;
    expect(out!.alpha[p]).toBe(255);
    const v = out!.filled[p * 4];
    expect(v === 90 || v === 170).toBe(true);
  });

  it("no toca una trama sin letras", () => {
    expect(liftHalo(halftone(W, H), W, H, seed, 1500)).toBeNull();
  });

  it("no toca manchas negras sin halo", () => {
    const px = halftone(W, H);
    for (let k = 0; k < 5; k++) rect(px, W, 80 + k * 20, 88, 6, 24, 20);
    expect(liftHalo(px, W, H, seed, 1500)).toBeNull();
  });
});

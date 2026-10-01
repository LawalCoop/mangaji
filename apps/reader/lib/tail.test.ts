import { describe, expect, it } from "vitest";
import { balloonTail } from "./tail";

/** Página blanca con un globo dibujado: elipse de contorno negro y una colita hacia abajo. */
function page() {
  const W = 300;
  const H = 300;
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  const ink = (x: number, y: number) => data.set([0, 0, 0, 255], (y * W + x) * 4);
  const cx = 150;
  const cy = 110;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const e = ((x - cx) / 80) ** 2 + ((y - cy) / 60) ** 2;
      // La colita: un triángulo que baja desde el globo hasta (130, 230).
      const inTail = y > 160 && y < 230 && Math.abs(x - (130 + (160 - y) * -0.0)) < (230 - y) * 0.25;
      const onTail = y > 160 && y < 232 && Math.abs(Math.abs(x - 130) - (230 - y) * 0.25) < 2;
      if ((e > 0.9 && e < 1.1 && !(inTail && y > 165)) || onTail) ink(x, y);
    }
  }
  return { data, W, H };
}

describe("colita del globo", () => {
  it("encuentra la punta de una colita que el modelo dejó fuera de la silueta", () => {
    const { data, W, H } = page();
    // La silueta del modelo: solo la elipse.
    const polygon: [number, number][] = [];
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * 2 * Math.PI;
      polygon.push([150 + 80 * Math.cos(a), 110 + 60 * Math.sin(a)]);
    }
    const tip = balloonTail(data, W, H, polygon)!;
    expect(tip).not.toBeNull();
    expect(tip[1]).toBeGreaterThan(200);
    expect(Math.abs(tip[0] - 130)).toBeLessThan(15);
  });
});

import { describe, expect, it } from "vitest";
import type { ProcessedPage } from "./process";
import { decodePage, encodePage } from "./shelf";

describe("guardar páginas procesadas", () => {
  it("una página vuelve igual de como se guardó", () => {
    const page = {
      index: 4,
      id: "p005",
      size: [800, 1200],
      page: { id: "p005", image: "pages/p005.webp", size: [800, 1200], panels: [{ id: "k" }] },
      image: new Uint8Array([1, 2, 3, 4, 5]),
      sprites: { "sprites/p005.b0.png": new Uint8Array([9, 9]), "sprites/p005.b1.png": new Uint8Array([7]) },
      panels: 1,
      balloons: 2,
    } as unknown as ProcessedPage;
    const back = decodePage(encodePage(page));
    expect(back.index).toBe(4);
    expect(back.page).toEqual(page.page);
    expect([...back.image]).toEqual([1, 2, 3, 4, 5]);
    expect(Object.fromEntries(Object.entries(back.sprites).map(([k, v]) => [k, [...v]]))).toEqual({
      "sprites/p005.b0.png": [9, 9],
      "sprites/p005.b1.png": [7],
    });
  });
});

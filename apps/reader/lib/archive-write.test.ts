import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { writeArchive, type ProcessedPage } from "./process";

describe("guardar el tomo procesado por partes", () => {
  it("arma el mismo .cbza que de una vez", async () => {
    const pages = [0, 1].map(
      (i) =>
        ({
          index: i,
          id: `p00${i + 1}`,
          size: [10, 10],
          page: { id: `p00${i + 1}`, image: `pages/p00${i + 1}.webp`, size: [10, 10], panels: [] },
          image: new Uint8Array([i, 1, 2, 3]),
          sprites: { [`sprites/p00${i + 1}.b0.png`]: new Uint8Array([9, 8, i]) },
          panels: 0,
          balloons: 0,
        }) as unknown as ProcessedPage,
    );
    const parts: Uint8Array[] = [];
    await writeArchive(pages, { write: async (c) => void parts.push(c) });
    const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) (all.set(p, o), (o += p.length));
    const files = unzipSync(all);
    expect(Object.keys(files).sort()).toEqual(
      ["manifest.json", "pages/p001.webp", "pages/p002.webp", "sprites/p001.b0.png", "sprites/p002.b0.png"].sort(),
    );
    expect([...files["pages/p002.webp"]]).toEqual([1, 1, 2, 3]);
    expect(JSON.parse(new TextDecoder().decode(files["manifest.json"])).pages).toHaveLength(2);
  });
});

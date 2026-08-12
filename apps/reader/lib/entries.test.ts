import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unzip, type UnzipFileInfo } from "fflate";
import { describe, expect, it } from "vitest";
import { isJunk, isPage, selectPages } from "./entries";

describe("selección de páginas", () => {
  it("descarta la basura que traen los CBZ reales", () => {
    expect(isJunk("__MACOSX/._1.jpg")).toBe(true);
    expect(isJunk("cap/.DS_Store")).toBe(true);
    expect(isJunk("cap/Thumbs.db")).toBe(true);
    expect(isJunk("cap/001.jpg")).toBe(false);
  });

  it("acepta solo imágenes, no metadatos ni directorios", () => {
    expect(isPage("ComicInfo.xml")).toBe(false);
    expect(isPage("cap/")).toBe(false);
    expect(isPage("cap/001.JPG")).toBe(true);
    expect(isPage("cap/001.webp")).toBe(true);
  });

  it("ordena numéricamente: 10 va después de 9, no después de 1", () => {
    const messy = ["10.jpg", "2.jpg", "1.jpg", "21.jpg", "3.jpg"];
    expect(selectPages(messy)).toEqual(["1.jpg", "2.jpg", "3.jpg", "10.jpg", "21.jpg"]);
  });

  it("ordena bien con prefijos y subcarpetas", () => {
    const messy = ["cap01/page-10.png", "cap01/page-2.png", "cap01/page-1.png"];
    expect(selectPages(messy)).toEqual([
      "cap01/page-1.png",
      "cap01/page-2.png",
      "cap01/page-10.png",
    ]);
  });
});

/**
 * Contra un CBZ de verdad: el fixture usa nombres sin ceros a la izquierda justamente
 * para que el orden lexicográfico falle si nos olvidamos del collator.
 */
const FIXTURE = join(import.meta.dirname, "../../../samples/test.cbz");

describe("contra un CBZ real", () => {
  it("lista las 12 páginas en orden y filtra el resto", async () => {
    let data: Buffer;
    try {
      data = readFileSync(FIXTURE);
    } catch {
      // El fixture está gitignoreado: se regenera con tools/fixtures/generate_cbz.py
      console.warn("sin fixture, se omite:", FIXTURE);
      return;
    }

    const names = await new Promise<string[]>((resolve, reject) => {
      const found: string[] = [];
      unzip(
        new Uint8Array(data),
        {
          filter(f: UnzipFileInfo) {
            found.push(f.name);
            return false;
          },
        },
        (err) => (err ? reject(err) : resolve(found)),
      );
    });

    expect(names).toContain("ComicInfo.xml");
    expect(names).toContain("__MACOSX/._1.jpg");

    const pages = selectPages(names);
    expect(pages).toEqual(Array.from({ length: 12 }, (_, i) => `${i + 1}.jpg`));
  });
});

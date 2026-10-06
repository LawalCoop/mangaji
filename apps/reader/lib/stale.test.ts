import { describe, expect, it } from "vitest";
import { isStaleChunk } from "./stale";

describe("isStaleChunk", () => {
  it("reconoce los errores de un pedazo de código que ya no está", () => {
    expect(isStaleChunk(new Error("Failed to load chunk /_next/static/chunks/38vykjn1l6p5j.js from module 1144"))).toBe(true);
    expect(isStaleChunk(new TypeError("Failed to fetch dynamically imported module: https://x/_next/a.js"))).toBe(true);
    expect(isStaleChunk(Object.assign(new Error("Loading chunk 12 failed."), { name: "ChunkLoadError" }))).toBe(true);
  });

  it("no confunde otros errores", () => {
    expect(isStaleChunk(new Error("No se pudo bajar /models/panels.onnx (404)"))).toBe(false);
    expect(isStaleChunk("Archivo cerrado")).toBe(false);
  });
});

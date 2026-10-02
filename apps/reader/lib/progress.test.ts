import { beforeEach, describe, expect, it } from "vitest";
import { bookKey, forget, savedPage, savePage } from "./progress";

describe("retomar la lectura", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
  });

  it("recuerda la página por tomo", () => {
    const key = bookKey({ name: "tomo.cbz", size: 1234 });
    expect(savedPage(key)).toBeNull();
    savePage(key, 40, 231);
    expect(savedPage(key)).toBe(40);
    expect(savedPage(bookKey({ name: "tomo.cbz", size: 999 }))).toBeNull();
  });

  it("al llegar al final, o al pedir empezar de nuevo, lo olvida", () => {
    const key = bookKey({ name: "tomo.cbz", size: 1234 });
    savePage(key, 230, 231);
    expect(savedPage(key)).toBeNull();
    savePage(key, 12, 231);
    forget(key);
    expect(savedPage(key)).toBeNull();
  });
});

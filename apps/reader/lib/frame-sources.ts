import type { Frame, FrameSource } from "./types";

/**
 * v1: un encuadre por página. El caso degenerado del que salen todos los demás.
 *
 * Cuando llegue v2, `PanelFrameSource` vive acá al lado y produce un Frame por viñeta
 * leyendo el manifest. El Director y la Camera no se enteran del cambio.
 */
export class PageFrameSource implements FrameSource {
  #sizes: { w: number; h: number }[];

  constructor(sizes: { w: number; h: number }[]) {
    this.#sizes = sizes;
  }

  get length(): number {
    return this.#sizes.length;
  }

  at(i: number): Frame {
    const size = this.#sizes[i] ?? { w: 1, h: 1 };
    return {
      id: `page-${i}`,
      page: i,
      rect: { x: 0, y: 0, w: size.w, h: size.h },
      // Un solo beat: corte seco y quedarse. La lectura la marca el usuario.
      beats: [{ t: 0, ms: 0, cam: { kind: "cut" } }],
    };
  }

  label(i: number): string {
    return `${i + 1} / ${this.length}`;
  }
}

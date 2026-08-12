import type { Manifest } from "@manganime/format";
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

/**
 * v2: un encuadre por viñeta, leído del manifest de un `.cbza`.
 *
 * Es todo lo que hizo falta agregar para el modo dirigido — el Director, la Camera y el
 * Stage son los mismos de v1. El modo página completa sigue disponible cambiando de fuente.
 */
export class PanelFrameSource implements FrameSource {
  #frames: Frame[];
  #pages: number;

  constructor(manifest: Manifest) {
    this.#pages = manifest.pages.length;
    this.#frames = manifest.pages.flatMap((page, pageIndex) =>
      page.panels.map((panel) => {
        const [x, y, w, h] = panel.bbox;
        return {
          id: panel.id,
          page: pageIndex,
          rect: { x, y, w, h },
          polygon: panel.polygon as [number, number][],
          beats: panel.beats,
          layers: panel.balloons.map((balloon) => {
            const [bx, by, bw, bh] = balloon.bbox;
            return {
              id: balloon.id,
              src: balloon.sprite,
              rect: { x: bx, y: by, w: bw, h: bh },
              hidden: Boolean(balloon.sprite), // sin sprite (v2) el globo ya está en el arte
              reveal: balloon.reveal,
            };
          }),
        } satisfies Frame;
      }),
    );
  }

  get length(): number {
    return this.#frames.length;
  }

  at(i: number): Frame {
    return this.#frames[i];
  }

  label(i: number): string {
    const frame = this.#frames[i];
    return `${frame.page + 1}/${this.#pages} · viñeta ${i + 1}/${this.length}`;
  }
}

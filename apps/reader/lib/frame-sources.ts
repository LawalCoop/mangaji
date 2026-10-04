import type { Manifest } from "@mangaji/format";
import type { Frame, FrameSource, Rect } from "./types";

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
  #frames: Frame[] = [];
  #pages = 0;
  /** Lo que se sabe de cada página, entero: lo usa el modo demo para contar el proceso. */
  #pageData: Manifest["pages"][number][] = [];
  /** Cuántas páginas va a tener el tomo, que se sabe antes de procesarlas. */
  #expected: number;
  #complete: boolean;

  /**
   * Con un manifest queda lista de una. Sin él nace vacía y se va llenando con `append`
   * mientras el archivo se procesa, que es lo que permite empezar a leer sin esperar.
   */
  constructor(manifest?: Manifest, expected = 0) {
    this.#expected = manifest ? manifest.pages.length : expected;
    this.#complete = manifest !== undefined;
    manifest?.pages.forEach((page, i) => this.append(page, i));
  }

  /** Suma los encuadres de una página recién procesada. Llegan en orden. */
  append(page: Manifest["pages"][number], pageIndex: number): void {
    this.#pages = Math.max(this.#pages, pageIndex + 1);
    this.#pageData[pageIndex] = page;
    for (const panel of page.panels) {
      this.#frames.push({
        id: panel.id,
        page: pageIndex,
        rect: framed(panel.bbox, panel.balloons.map((b) => b.bbox)),
        polygon: panel.polygon as [number, number][],
        beats: panel.beats,
        tension: panel.look?.tension,
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
      } satisfies Frame);
    }
  }

  /** La página procesada, si ya está. */
  pageData(index: number): Manifest["pages"][number] | undefined {
    return this.#pageData[index];
  }

  /** Cuántas páginas va a tener el tomo. */
  get pageTotal(): number {
    return Math.max(this.#expected, this.#pages);
  }

  /** No llegan más páginas: de acá en más el final de la fuente es el final del tomo. */
  finish(): void {
    this.#complete = true;
    this.#expected = this.#pages;
  }

  get complete(): boolean {
    return this.#complete;
  }

  get length(): number {
    return this.#frames.length;
  }

  at(i: number): Frame {
    return this.#frames[i];
  }

  label(i: number): string {
    const frame = this.#frames[i];
    const total = Math.max(this.#expected, this.#pages);
    return `${frame.page + 1}/${total} · viñeta ${i + 1}/${this.length}`;
  }
}

/**
 * Lo que encuadra la cámara: la viñeta y sus globos.
 *
 * Los globos se salen seguido de la viñeta —pisan el borde, o la calle— y encuadrando solo
 * la viñeta quedaban cortados, sin poder leerse.
 */
export function framed(panel: number[], balloons: number[][]): Rect {
  let [x0, y0] = panel;
  let x1 = panel[0] + panel[2];
  let y1 = panel[1] + panel[3];
  for (const [x, y, w, h] of balloons) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + w);
    y1 = Math.max(y1, y + h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

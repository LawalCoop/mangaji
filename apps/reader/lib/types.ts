import type { Beat } from "@mangaji/format";

export type Rect = { x: number; y: number; w: number; h: number };

/**
 * Una capa que se dibuja encima del arte base dentro de un encuadre.
 * v1 no emite ninguna; v4 las usa para el diálogo.
 */
export type Layer = {
  id: string;
  /** ruta de la entrada dentro del archivo */
  src: string;
  rect: Rect;
  /** empieza oculta y aparece en su beat `reveal` */
  hidden?: boolean;
  reveal?: "typewriter" | "pop" | "fade";
};

/**
 * La unidad que el reader sabe mostrar: un recorte de una página, con su timeline.
 *
 * La página entera es el caso degenerado — un Frame cuyo rect es la página completa.
 * Por eso el modo página y el modo viñeta comparten todo el motor y solo difieren en
 * qué FrameSource los produce.
 */
export type Frame = {
  id: string;
  /** índice de página en el archivo: lo que hay que tener decodificado para dibujarlo */
  page: number;
  rect: Rect;
  /** máscara para viñetas no rectangulares (v2). En coords de la página. */
  polygon?: [number, number][];
  beats: Beat[];
  layers?: Layer[];
};

/**
 * De dónde salen los encuadres. **Este es el punto de extensión del proyecto entero.**
 *
 *  v1  PageFrameSource   un frame por página
 *  v2  PanelFrameSource  un frame por viñeta, leído del manifest
 *  v4  agrega layers a los frames que ya existen
 *  v5  agrega fx a los beats que ya existen
 *
 * Cada versión suma un implementador o enriquece los datos; el motor no se toca.
 */
export interface FrameSource {
  readonly length: number;
  at(i: number): Frame;
  /** nombre legible del punto actual, para la UI (ej. "12 / 180") */
  label(i: number): string;
}

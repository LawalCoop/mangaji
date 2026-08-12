import { z } from "zod";

/**
 * Esquema del manifest `.cbza` — la fuente de verdad compartida entre el CLI de Python
 * (que lo escribe), el reader (que lo reproduce) y el editor (que lo reescribe).
 *
 * Regla de oro: los beats son DATOS, no código. Cambiar la dirección de una viñeta nunca
 * debe requerir reprocesar imágenes.
 */

const Point = z.tuple([z.number(), z.number()]);
const Rect = z.tuple([z.number(), z.number(), z.number(), z.number()]);

/** Cómo encuadra la cámara una viñeta. `cut` es el corte seco sin movimiento. */
export const CameraMove = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cut") }),
  z.object({ kind: z.literal("punchIn"), from: z.number().default(1.12), to: z.number().default(1) }),
  z.object({ kind: z.literal("pullBack"), from: z.number().default(1), to: z.number().default(1.12) }),
  z.object({ kind: z.literal("panH"), dir: z.enum(["ltr", "rtl"]).default("rtl") }),
  z.object({ kind: z.literal("tiltV"), dir: z.enum(["down", "up"]).default("down") }),
  z.object({ kind: z.literal("kenBurns"), zoom: z.number().default(1.08), angle: z.number().default(0) }),
]);
export type CameraMove = z.infer<typeof CameraMove>;

/** Efectos de v5. Un máximo de uno por viñeta: el default es no tener ninguno. */
export const Fx = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("shake"), amp: z.number().default(6) }),
  z.object({ kind: z.literal("flash"), strength: z.number().default(0.8) }),
  z.object({ kind: z.literal("speedlines"), angle: z.number().default(0), density: z.number().default(0.5) }),
  z.object({ kind: z.literal("grain"), amount: z.number().default(0.15) }),
  z.object({ kind: z.literal("vignette"), amount: z.number().default(0.3) }),
]);
export type Fx = z.infer<typeof Fx>;

/**
 * Una unidad del timeline. `t` es el offset en ms desde que arranca la viñeta.
 * Los campos son opcionales y combinables: un beat puede mover la cámara y revelar a la vez.
 */
export const Beat = z.object({
  t: z.number().min(0),
  ms: z.number().min(0).default(0),
  cam: CameraMove.optional(),
  /** id del globo a revelar (v4) */
  reveal: z.string().optional(),
  fx: Fx.optional(),
  /** pausa sin acción, para dar aire de lectura */
  hold: z.number().min(0).optional(),
});
export type Beat = z.infer<typeof Beat>;

/**
 * Un globo. `mode` decide qué se oculta:
 *  - `text-only` (default): solo el texto. El globo vacío queda en el arte base y el hueco se
 *    rellena con blanco, que es exacto porque el interior del globo ya era blanco plano.
 *  - `extract`: el globo entero, con inpainting del fondo. Solo sirve sobre fondos simples.
 */
export const Balloon = z.object({
  id: z.string(),
  order: z.number().int().min(0),
  mode: z.enum(["text-only", "extract"]).default("text-only"),
  sprite: z.string(),
  bbox: Rect,
  /** proporción de píxeles de tinta — aproxima cuánto texto hay, y de ahí sale la duración */
  inkArea: z.number().min(0).max(1).default(0),
  reveal: z.enum(["typewriter", "pop", "fade"]).default("typewriter"),
});
export type Balloon = z.infer<typeof Balloon>;

export const Panel = z.object({
  id: z.string(),
  order: z.number().int().min(0),
  /** cuadrilátero o más — soporta viñetas diagonales, que son mayoría en manga de acción */
  polygon: z.array(Point).min(3),
  bbox: Rect,
  /** 0..1; por debajo de ~0.6 el editor la marca como dudosa */
  confidence: z.number().min(0).max(1).default(1),
  balloons: z.array(Balloon).default([]),
  beats: z.array(Beat).default([]),
});
export type Panel = z.infer<typeof Panel>;

export const Page = z.object({
  id: z.string(),
  image: z.string(),
  size: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  panels: z.array(Panel).default([]),
});
export type Page = z.infer<typeof Page>;

export const Manifest = z.object({
  version: z.literal(1),
  title: z.string().optional(),
  readingDirection: z.enum(["rtl", "ltr"]).default("rtl"),
  /** herramienta y versión que lo generó, para poder migrar manifests viejos */
  generator: z.string().optional(),
  pages: z.array(Page).min(1),
});
export type Manifest = z.infer<typeof Manifest>;

export const MANIFEST_FILENAME = "manifest.json";

/** Lanza con detalle si el manifest no es válido. Usar al abrir un `.cbza`. */
export function parseManifest(raw: unknown): Manifest {
  return Manifest.parse(raw);
}

/** Variante sin excepciones, para el editor, que tiene que poder mostrar el error. */
export function safeParseManifest(raw: unknown) {
  return Manifest.safeParse(raw);
}

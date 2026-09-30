/**
 * Lo que el pipeline le cuenta a la interfaz, sin texto.
 *
 * El procesamiento corre en workers, que no saben en qué idioma está la página, y su
 * registro sigue a la vista mientras se lee: si mandaran frases hechas, cambiar de idioma
 * dejaría el registro a medias. Mandan qué pasó y con qué datos, y la interfaz lo dice en
 * el idioma que corresponda en cada momento (ver `lib/i18n.tsx`).
 */

/** Un paso del procesamiento. */
export type Note =
  | { key: "unpacking" }
  | { key: "pageCount"; n: number }
  | { key: "gpu" }
  | { key: "noGpu" }
  | { key: "downloadingModels" }
  | { key: "loadingPanels" }
  | { key: "loadingDialogue" }
  | { key: "findingPanels" }
  | { key: "liftingDialogue"; n: number };

/** Un error que se le explica a quien lee, en vez de mostrarle el mensaje técnico. */
export type Problem =
  | { code: "noImages" }
  | { code: "notATome"; ext: string }
  | { code: "linkEmpty" }
  | { code: "linkInvalid" }
  | { code: "linkDrive" }
  | { code: "linkBlocked" }
  | { code: "offline" }
  | { code: "linkMissing" }
  | { code: "linkPrivate" }
  | { code: "linkHttp"; status: number }
  | { code: "linkPage" }
  /** Algo inesperado: se muestra el detalle técnico tal cual, que es lo único que hay. */
  | { code: "unexpected"; detail: string };

export class ProblemError extends Error {
  constructor(readonly problem: Problem) {
    super(problem.code);
  }
}

/** Lo que se sabe de un error cualquiera, para explicarlo. */
export function problemOf(err: unknown): Problem {
  if (err instanceof ProblemError) return err.problem;
  return { code: "unexpected", detail: err instanceof Error ? err.message : String(err) };
}

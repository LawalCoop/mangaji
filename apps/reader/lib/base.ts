/**
 * Prefijo bajo el que se sirve la app.
 *
 * En desarrollo es la raíz, pero publicada en GitHub Pages vive en `/<repo>/` y todo lo que
 * se pide a mano —modelos, runtimes, música— tiene que llevarlo: Next solo lo agrega a sus
 * propios enlaces y assets.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Ruta absoluta a un archivo de `public/`, con el prefijo de la app. */
export function asset(path: string): string {
  return `${BASE_PATH}${path}`;
}

/**
 * Pestaña con una versión vieja del sitio.
 *
 * Cada publicación cambia los nombres de los pedazos de código que se cargan a demanda (el
 * procesamiento, los modelos, el lector de RAR). Una pestaña abierta desde antes los pide con
 * el nombre viejo, no están más, y abrir un tomo fallaba con "Failed to load chunk". Ahí se
 * recarga la página una vez, que trae la versión nueva; si vuelve a pasar enseguida, ya no es
 * eso y se muestra el error.
 */

const KEY = "mangaji:stale-reload";
/** Si se recargó hace menos que esto y volvió a fallar, el problema es otro. */
const AGAIN_MS = 60_000;

export function isStaleChunk(err: unknown): boolean {
  const text = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return /ChunkLoadError|Failed to load chunk|Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed/i.test(
    text,
  );
}

/** Recarga si el error es de una versión vieja. Devuelve si se va a recargar. */
export function reloadIfStale(err: unknown): boolean {
  if (typeof window === "undefined" || !isStaleChunk(err)) return false;
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < AGAIN_MS) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // Sin almacenamiento no hay cómo evitar recargar en bucle: mejor mostrar el error.
    return false;
  }
  window.location.reload();
  return true;
}

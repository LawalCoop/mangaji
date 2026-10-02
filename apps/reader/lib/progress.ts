/**
 * Por dónde va cada tomo, para retomar al volver a abrirlo.
 *
 * Se guarda en el navegador y solo la página: el tomo se reconoce por nombre y tamaño del
 * archivo, que alcanza para distinguirlos sin leer el contenido. Al terminarlo se borra, así
 * la próxima vez arranca de nuevo.
 */

const KEY = "mangaji:progress";
/** Cuántos tomos se recuerdan; al pasarse se olvida el que hace más que no se abre. */
const LIMIT = 60;

type Entry = { page: number; pages: number; at: number };

/** La identidad de un tomo: nombre y tamaño. */
export function bookKey(file: { name: string; size: number }): string {
  return `${file.name}|${file.size}`;
}

function read(): Record<string, Entry> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, Entry>;
  } catch {
    return {};
  }
}

function write(all: Record<string, Entry>): void {
  try {
    const keys = Object.keys(all);
    if (keys.length > LIMIT) {
      keys
        .sort((a, b) => all[a].at - all[b].at)
        .slice(0, keys.length - LIMIT)
        .forEach((k) => delete all[k]);
    }
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Sin almacenamiento: no se recuerda, y se lee igual.
  }
}

/** La página (desde 0) por la que se iba, o null si no hay nada que retomar. */
export function savedPage(key: string): number | null {
  const entry = read()[key];
  return entry && entry.page > 0 ? entry.page : null;
}

/** Anota por dónde se va. En la última página se olvida: el tomo está leído. */
export function savePage(key: string, page: number, pages: number): void {
  const all = read();
  if (page >= pages - 1) delete all[key];
  else all[key] = { page, pages, at: Date.now() };
  write(all);
}

/** Olvida el tomo, para empezarlo de nuevo. */
export function forget(key: string): void {
  const all = read();
  delete all[key];
  write(all);
}

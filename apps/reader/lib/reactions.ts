/**
 * Reacciones a viñetas, guardadas en este navegador nomás.
 *
 * Por tomo (la misma clave con que se recuerda por dónde se iba) y por viñeta: la página y
 * el id del encuadre. Una reacción por viñeta; elegir otra la reemplaza.
 */

export const REACTIONS = ["❤️", "😂", "😮", "😢", "😡", "🔥"] as const;
export type Reaction = (typeof REACTIONS)[number];

type Entry = { r: Reaction; at: number };

const KEY = "mangaji:reactions";

function read(): Record<string, Record<string, Entry>> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, Record<string, Entry>>;
  } catch {
    return {};
  }
}

function write(all: Record<string, Record<string, Entry>>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Sin almacenamiento (ventana privada, sitio bloqueado): la reacción vale mientras dure.
  }
}

const panelKey = (page: number, frame: string) => `${page}:${frame}`;

export function reactionOf(book: string, page: number, frame: string): Reaction | null {
  return read()[book]?.[panelKey(page, frame)]?.r ?? null;
}

/** Guarda la reacción, o la quita con `null`. */
export function react(book: string, page: number, frame: string, r: Reaction | null): void {
  const all = read();
  const mine = (all[book] ??= {});
  if (r) mine[panelKey(page, frame)] = { r, at: Date.now() };
  else delete mine[panelKey(page, frame)];
  if (Object.keys(mine).length === 0) delete all[book];
  write(all);
}

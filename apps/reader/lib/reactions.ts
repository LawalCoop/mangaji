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

/** Todas las reacciones de un tomo, en orden de lectura. */
export function reactionsOf(book: string): { page: number; frame: string; r: Reaction; at: number }[] {
  return Object.entries(read()[book] ?? {})
    .map(([key, e]) => {
      const [page, ...rest] = key.split(":");
      return { page: Number(page), frame: rest.join(":"), r: e.r, at: e.at };
    })
    .sort((a, b) => a.page - b.page || a.at - b.at);
}

/**
 * Frases guardadas: un globo de diálogo que el lector marcó. No hay texto —el diálogo es una
 * imagen recortada de la página—, así que se guarda dónde está: página, viñeta y globo.
 */
type Quote = { frame: string; at: number };
const QUOTES = "mangaji:quotes";

function readQuotes(): Record<string, Record<string, Quote>> {
  try {
    return JSON.parse(localStorage.getItem(QUOTES) ?? "{}") as Record<string, Record<string, Quote>>;
  } catch {
    return {};
  }
}

function writeQuotes(all: Record<string, Record<string, Quote>>): void {
  try {
    localStorage.setItem(QUOTES, JSON.stringify(all));
  } catch {
    // Sin almacenamiento, la frase vale mientras dure.
  }
}

/** Guarda la frase, o la saca si ya estaba. Devuelve si quedó guardada. */
export function toggleQuote(book: string, page: number, frame: string, layer: string): boolean {
  const all = readQuotes();
  const mine = (all[book] ??= {});
  const key = `${page}:${layer}`;
  const saved = !mine[key];
  if (saved) mine[key] = { frame, at: Date.now() };
  else delete mine[key];
  if (Object.keys(mine).length === 0) delete all[book];
  writeQuotes(all);
  return saved;
}

/** Las frases de un tomo, en orden de lectura. */
export function quotesOf(book: string): { page: number; frame: string; layer: string; at: number }[] {
  return Object.entries(readQuotes()[book] ?? {})
    .map(([key, q]) => {
      const [page, ...rest] = key.split(":");
      return { page: Number(page), layer: rest.join(":"), frame: q.frame, at: q.at };
    })
    .sort((a, b) => a.page - b.page || a.at - b.at);
}

import type { ProcessedPage } from "./process";

/**
 * Los últimos tomos procesados, guardados página por página en el navegador.
 *
 * Cada página se guarda apenas se procesa, así que al volver a abrir el mismo archivo se
 * cargan las que ya estaban y se sigue desde la primera que falta; si están todas, abre sin
 * procesar nada. Van al almacenamiento privado del sitio (OPFS): no salen del dispositivo.
 *
 * Un tomo se reconoce por nombre y tamaño del archivo original y por la versión del
 * procesamiento: si el procesamiento cambia, lo guardado con la versión anterior deja de
 * servir y se vuelve a procesar.
 */

/** Sube cuando cambia el procesamiento, para no reabrir tomos procesados con errores viejos. */
export const PROCESSING_VERSION = 2;
const INDEX = "mangaji:shelf";
const DIR = "pages";
/** Cuántos tomos se guardan; al pasarse se borra el que hace más que no se abre. */
const KEEP = 3;

/** `total`: las páginas del tomo, para saber sin abrir el archivo si ya están todas. */
type Entry = { dir: string; at: number; total?: number };

function index(): Record<string, Entry> {
  try {
    const all = JSON.parse(localStorage.getItem(INDEX) ?? "{}") as Record<string, Entry>;
    // Formato anterior (un .cbza por tomo): se descarta.
    for (const k of Object.keys(all)) if (!all[k].dir) delete all[k];
    return all;
  } catch {
    return {};
  }
}

function saveIndex(all: Record<string, Entry>): void {
  try {
    localStorage.setItem(INDEX, JSON.stringify(all));
  } catch {
    // Sin índice no se encuentra lo guardado: se procesa como siempre.
  }
}

let cleaned = false;

async function root(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const top = await navigator.storage.getDirectory();
    // Lo del formato anterior ocupa lugar y ya no se usa: se borra una vez, de fondo.
    if (!cleaned) {
      cleaned = true;
      void top.removeEntry("shelf", { recursive: true }).catch(() => {});
    }
    return await top.getDirectoryHandle(DIR, { create: true });
  } catch {
    return null;
  }
}

const versioned = (key: string) => `${PROCESSING_VERSION}|${key}`;

function dirName(key: string): string {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return `t${(h >>> 0).toString(36)}`;
}

const pageFile = (i: number) => `${String(i).padStart(4, "0")}.bin`;

/** Una página en un solo archivo: largo del encabezado, encabezado JSON y los bytes. */
export function encodePage(page: ProcessedPage): Uint8Array {
  const sprites = Object.entries(page.sprites);
  const header = new TextEncoder().encode(
    JSON.stringify({
      index: page.index,
      id: page.id,
      size: page.size,
      page: page.page,
      panels: page.panels,
      balloons: page.balloons,
      image: page.image.length,
      sprites: sprites.map(([name, data]) => [name, data.length]),
    }),
  );
  const total = 4 + header.length + page.image.length + sprites.reduce((n, [, d]) => n + d.length, 0);
  const out = new Uint8Array(total);
  new DataView(out.buffer).setUint32(0, header.length);
  out.set(header, 4);
  let o = 4 + header.length;
  out.set(page.image, o);
  o += page.image.length;
  for (const [, data] of sprites) {
    out.set(data, o);
    o += data.length;
  }
  return out;
}

export function decodePage(bytes: Uint8Array): ProcessedPage {
  const length = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0);
  const h = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + length)));
  let o = 4 + length;
  const image = bytes.slice(o, o + h.image);
  o += h.image;
  const sprites: Record<string, Uint8Array> = {};
  for (const [name, len] of h.sprites as [string, number][]) {
    sprites[name] = bytes.slice(o, o + len);
    o += len;
  }
  return { index: h.index, id: h.id, size: h.size, page: h.page, panels: h.panels, balloons: h.balloons, image, sprites };
}

/**
 * Una página guardada, sin leer todavía: el arte y los globos quedan como porciones del
 * archivo y se leen recién cuando se muestran. Cargar un tomo entero de golpe dejaba al
 * celular sin memoria.
 */
export type ShelvedPage = Omit<ProcessedPage, "image" | "sprites"> & {
  image: Blob;
  sprites: Record<string, Blob>;
};

/** Lee solo el encabezado de una página guardada; el resto queda como porciones del archivo. */
async function openPage(file: Blob): Promise<ShelvedPage> {
  const length = new DataView(await file.slice(0, 4).arrayBuffer()).getUint32(0);
  const h = JSON.parse(await file.slice(4, 4 + length).text());
  let o = 4 + length;
  const image = file.slice(o, o + h.image, "image/webp");
  o += h.image;
  const sprites: Record<string, Blob> = {};
  for (const [name, len] of h.sprites as [string, number][]) {
    sprites[name] = file.slice(o, o + len, "image/png");
    o += len;
  }
  return { index: h.index, id: h.id, size: h.size, page: h.page, panels: h.panels, balloons: h.balloons, image, sprites };
}

/** Si el almacenamiento no responde en este tiempo, se procesa como si no hubiera nada. */
const PATIENCE_MS = 5000;
const patiently = <T>(task: Promise<T>, fallback: T): Promise<T> =>
  Promise.race([task, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), PATIENCE_MS))]).catch(
    () => fallback,
  );

/**
 * Las páginas ya procesadas de este tomo, desde la primera y sin huecos, y cuántas tiene el
 * tomo, si se sabe: con todas guardadas no hace falta ni descomprimir el archivo.
 */
export function shelvedPages(key: string): Promise<{ pages: ShelvedPage[]; total: number | null }> {
  return patiently(readShelf(key), { pages: [], total: null });
}

async function readShelf(key: string): Promise<{ pages: ShelvedPage[]; total: number | null }> {
  const none = { pages: [], total: null };
  const all = index();
  const entry = all[versioned(key)];
  if (!entry) return none;
  const top = await root();
  if (!top) return none;
  try {
    const dir = await top.getDirectoryHandle(entry.dir);
    const pages: ShelvedPage[] = [];
    for (let i = 0; ; i++) {
      const handle = await dir.getFileHandle(pageFile(i)).catch(() => null);
      if (!handle) break;
      pages.push(await openPage(await handle.getFile()));
    }
    entry.at = Date.now();
    saveIndex(all);
    return { pages, total: entry.total ?? null };
  } catch {
    return none;
  }
}

/**
 * Anota un tomo para empezar a guardarlo, haciendo lugar si hace falta. Devuelve con qué
 * guardar cada página, o null si no se puede guardar.
 */
export function shelf(key: string, total: number): Promise<((page: ProcessedPage) => Promise<void>) | null> {
  return patiently(openShelf(key, total), null);
}

async function openShelf(key: string, total: number): Promise<((page: ProcessedPage) => Promise<void>) | null> {
  const top = await root();
  if (!top) return null;
  const all = index();
  const mine = versioned(key);
  // Lo de versiones anteriores ya no sirve, y se deja lugar para este.
  const stale = Object.keys(all).filter((k) => !k.startsWith(`${PROCESSING_VERSION}|`));
  const old = Object.keys(all)
    .filter((k) => k.startsWith(`${PROCESSING_VERSION}|`) && k !== mine)
    .sort((a, b) => all[b].at - all[a].at)
    .slice(KEEP - 1);
  for (const k of [...stale, ...old]) {
    await top.removeEntry(all[k].dir, { recursive: true }).catch(() => {});
    delete all[k];
  }
  const name = dirName(mine);
  all[mine] = { dir: name, at: Date.now(), total };
  saveIndex(all);
  navigator.storage.persist?.().catch(() => {});

  let dir: FileSystemDirectoryHandle;
  try {
    dir = await top.getDirectoryHandle(name, { create: true });
  } catch {
    return null;
  }
  let full = false;
  return async (page) => {
    if (full) return;
    try {
      const handle = await dir.getFileHandle(pageFile(page.index), { create: true });
      const out = await handle.createWritable();
      await out.write(encodePage(page) as Uint8Array<ArrayBuffer>);
      await out.close();
    } catch {
      // Sin lugar, o el navegador no deja escribir: se sigue leyendo sin guardar.
      full = true;
    }
  };
}

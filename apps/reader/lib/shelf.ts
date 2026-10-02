/**
 * Los últimos tomos procesados, guardados en el navegador para no procesarlos de nuevo.
 *
 * Van al almacenamiento privado del sitio (OPFS): no salen del dispositivo, igual que
 * todo lo demás. Se reconocen por nombre y tamaño del archivo original y por la versión
 * del procesamiento: si el procesamiento cambia, lo guardado con la versión anterior deja
 * de servir y se vuelve a procesar.
 */

/** Sube cuando cambia el procesamiento, para no reabrir tomos procesados con errores viejos. */
export const PROCESSING_VERSION = 1;
const INDEX = "mangaji:shelf";
const DIR = "shelf";
/** Cuántos tomos se guardan; al pasarse se borra el que hace más que no se abre. */
const KEEP = 3;

type Entry = { file: string; at: number };

function index(): Record<string, Entry> {
  try {
    return JSON.parse(localStorage.getItem(INDEX) ?? "{}") as Record<string, Entry>;
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

async function folder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(DIR, { create: true });
  } catch {
    return null;
  }
}

const versioned = (key: string) => `${PROCESSING_VERSION}|${key}`;

/** Un nombre de archivo seguro y corto a partir de la clave. */
function fileName(key: string): string {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return `t${(h >>> 0).toString(36)}.cbza`;
}

/** El `.cbza` guardado de este tomo, o null si no hay. */
export async function shelved(key: string): Promise<File | null> {
  const all = index();
  const entry = all[versioned(key)];
  if (!entry) return null;
  const dir = await folder();
  if (!dir) return null;
  try {
    const file = await (await dir.getFileHandle(entry.file)).getFile();
    entry.at = Date.now();
    saveIndex(all);
    return new File([file], entry.file, { type: "application/zip" });
  } catch {
    delete all[versioned(key)];
    saveIndex(all);
    return null;
  }
}

/**
 * Guarda el tomo procesado. `write` recibe dónde escribir y lo hace por partes. Si no hay
 * lugar o el navegador no lo permite, no se guarda y no pasa nada.
 */
export async function shelve(
  key: string,
  bytes: number,
  write: (out: FileSystemWritableFileStream) => Promise<void>,
): Promise<boolean> {
  const dir = await folder();
  if (!dir) return false;
  try {
    const { quota = 0, usage = 0 } = await navigator.storage.estimate();
    if (quota - usage < bytes * 1.3) return false;
  } catch {
    // Sin estimación se intenta igual.
  }

  const all = index();
  // Lo de versiones anteriores ya no sirve; y se deja lugar para el nuevo.
  const stale = Object.keys(all).filter((k) => !k.startsWith(`${PROCESSING_VERSION}|`));
  const old = Object.keys(all)
    .filter((k) => k.startsWith(`${PROCESSING_VERSION}|`) && k !== versioned(key))
    .sort((a, b) => all[b].at - all[a].at)
    .slice(KEEP - 1);
  for (const k of [...stale, ...old]) {
    await dir.removeEntry(all[k].file).catch(() => {});
    delete all[k];
  }

  const name = fileName(versioned(key));
  try {
    const handle = await dir.getFileHandle(name, { create: true });
    const out = await handle.createWritable();
    await write(out);
    await out.close();
  } catch {
    await dir.removeEntry(name).catch(() => {});
    return false;
  }
  all[versioned(key)] = { file: name, at: Date.now() };
  saveIndex(all);
  // Que el navegador no lo borre por su cuenta si se queda sin lugar, cuando lo permite.
  navigator.storage.persist?.().catch(() => {});
  return true;
}

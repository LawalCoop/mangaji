import { isPage, sortPages } from "./entries";
import { asset } from "./base";

/**
 * Lectura de CBR, que es un RAR.
 *
 * Un ZIP se descomprime con `fflate` en unas pocas líneas. RAR no: el formato es cerrado y no hay implementación razonable en JavaScript
 * puro, así que se usa libarchive compilado a WebAssembly —un mega, contra los cincuenta de
 * los modelos—.
 *
 * Los tomos suelen venir en este formato, así que soportarlo no es un extra.
 */

export type RarEntry = { name: string; file: File };

/** ¿El archivo es un RAR? Se mira la firma, no la extensión. */
export async function isRar(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  // "Rar!\x1a\x07" seguido de 0x00 (RAR4) o 0x01 (RAR5).
  return (
    head[0] === 0x52 &&
    head[1] === 0x61 &&
    head[2] === 0x72 &&
    head[3] === 0x21 &&
    head[4] === 0x1a &&
    head[5] === 0x07
  );
}

/**
 * libarchive admite una sola inicialización por sesión y falla con "Session already started"
 * si se la pide de nuevo, así que se guarda la promesa y se reutiliza.
 */
let ready: Promise<typeof import("libarchive.js").Archive> | null = null;
/** El worker que creó libarchive para la apertura en curso, para vigilarlo y cortarlo. */
let current: Worker | null = null;

function archiveLib() {
  ready ??= import("libarchive.js").then(({ Archive }) => {
    Archive.init({
      getWorker: () => {
        current = new Worker(asset("/libarchive/worker-bundle.js"), { type: "module" });
        return current;
      },
    });
    return Archive;
  });
  return ready;
}

/** Si el arranque —bajar y preparar el descompresor— no responde en este tiempo, se reintenta. */
const START_MS = 20_000;
/** Y la descompresión: un margen fijo más un segundo cada tantos bytes del archivo. */
const EXTRACT = { baseMs: 60_000, bytesPerSecond: 2_000_000 };

/**
 * Espera `task`, pero no para siempre: si el worker se cae —en el celular, sin memoria— o no
 * responde, libarchive no avisa y la carga quedaba trabada en "descomprimiendo".
 */
function guarded<T>(task: Promise<T>, worker: Worker | null, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const fail = (why: string) => {
      worker?.terminate();
      reject(new Error(`${what}: ${why}`));
    };
    const timer = setTimeout(() => fail("no respondió"), ms);
    const onError = (ev: ErrorEvent) => fail(ev.message || "se cayó");
    worker?.addEventListener("error", onError);
    task.then(
      (v) => {
        clearTimeout(timer);
        worker?.removeEventListener("error", onError);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        worker?.removeEventListener("error", onError);
        reject(e);
      },
    );
  });
}

export async function readRar(file: File): Promise<RarEntry[]> {
  const Archive = await archiveLib();

  // El arranque se reintenta una vez: a veces el worker no termina de cargar y no avisa.
  let archive: Awaited<ReturnType<typeof Archive.open>> | null = null;
  for (let attempt = 0; attempt < 2 && !archive; attempt++) {
    current = null;
    const opening = Archive.open(file);
    try {
      archive = await guarded(opening, null, START_MS, "No se pudo preparar el descompresor");
    } catch (err) {
      (current as Worker | null)?.terminate();
      if (attempt === 1) throw err;
    }
  }
  const worker = current;

  try {
    // El listado viene anidado por carpetas; se aplana conservando la ruta, que es lo que
    // define el orden cuando el tomo trae un directorio por capítulo.
    const limit = EXTRACT.baseMs + (file.size / EXTRACT.bytesPerSecond) * 1000;
    const flat = await guarded(archive!.extractFiles(), worker, limit, "No se pudo descomprimir el archivo");

    const found: RarEntry[] = [];
    const walk = (node: Record<string, unknown>, prefix: string) => {
      for (const [name, value] of Object.entries(node)) {
        const path = prefix ? `${prefix}/${name}` : name;
        if (value instanceof File) {
          if (isPage(path)) found.push({ name: path, file: value });
        } else if (value && typeof value === "object") {
          walk(value as Record<string, unknown>, path);
        }
      }
    };
    walk(flat as Record<string, unknown>, "");

    const order = sortPages(found.map((f) => f.name));
    return order.map((name) => found.find((f) => f.name === name)!);
  } finally {
    // Sin cerrar, la próxima apertura encuentra la sesión ocupada.
    await archive!.close();
  }
}

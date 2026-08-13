import { isPage, sortPages } from "./entries";

/**
 * Lectura de CBR, que es un RAR.
 *
 * El resto del lector trabaja sobre ZIP, que se descomprime con `fflate` en unas pocas
 * líneas. RAR no: el formato es cerrado y no hay implementación razonable en JavaScript
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

function archiveLib() {
  ready ??= import("libarchive.js").then(({ Archive }) => {
    Archive.init({ workerUrl: "/libarchive/worker-bundle.js" });
    return Archive;
  });
  return ready;
}

/** Páginas del CBR, en orden de lectura y ya descomprimidas. */
export async function readRar(file: File): Promise<RarEntry[]> {
  const Archive = await archiveLib();
  const archive = await Archive.open(file);

  try {
    // El listado viene anidado por carpetas; se aplana conservando la ruta, que es lo que
    // define el orden cuando el tomo trae un directorio por capítulo.
    const flat = await archive.extractFiles();

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
    await archive.close();
  }
}

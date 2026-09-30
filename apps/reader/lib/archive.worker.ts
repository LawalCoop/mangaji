/// <reference lib="webworker" />
import { unzip, type UnzipFileInfo } from "fflate";
import { isPage, sortPages } from "./entries";

/**
 * Worker de archivo: mantiene el CBZ comprimido en memoria y **infla una entrada a la vez**,
 * bajo demanda. Un tomo entero descomprimido serían cientos de MB; así solo vive el zip
 * original más las páginas que el reader tenga en vuelo.
 *
 * Un CBR llega distinto: libarchive ya lo descomprimió y lo que se recibe son las páginas
 * sueltas, como `Blob`. Pasar un `Blob` a un worker no copia los bytes, así que el tomo vive
 * una sola vez en memoria y cada página se lee recién cuando se pide.
 *
 * La decodificación a ImageBitmap también pasa acá, para no bloquear el hilo principal.
 */

let archive: Uint8Array | null = null;
let loose: Map<string, Blob> | null = null;
let entries: string[] = [];

type Req =
  | { id: number; kind: "open"; buffer: ArrayBuffer }
  | { id: number; kind: "openFiles"; files: { name: string; blob: Blob }[] }
  | { id: number; kind: "bitmap"; index: number }
  | { id: number; kind: "bitmapOf"; name: string }
  | { id: number; kind: "text"; name: string };

self.onmessage = async (ev: MessageEvent<Req>) => {
  const msg = ev.data;
  try {
    if (msg.kind === "open" || msg.kind === "openFiles") {
      let found: string[];
      if (msg.kind === "open") {
        archive = new Uint8Array(msg.buffer);
        found = await listAll(archive);
      } else {
        loose = new Map(msg.files.map((f) => [f.name, f.blob]));
        found = [...loose.keys()];
      }
      entries = sortPages(found.filter(isPage));
      if (entries.length === 0) throw new Error("El archivo no contiene imágenes");
      // Un `.cbza` trae manifest; un CBZ común, no. Es lo que decide el modo de lectura.
      self.postMessage({ id: msg.id, ok: true, entries, all: found });
      return;
    }

    if (msg.kind === "text") {
      const text = await (await read(msg.name)).text();
      self.postMessage({ id: msg.id, ok: true, text });
      return;
    }

    if (msg.kind === "bitmap" || msg.kind === "bitmapOf") {
      const name = msg.kind === "bitmapOf" ? msg.name : entries[msg.index];
      if (!name) throw new Error("Entrada inexistente");
      // El tipo lo infiere el decodificador; no hace falta acertar el mime exacto.
      const bitmap = await createImageBitmap(await read(name));
      self.postMessage({ id: msg.id, ok: true, bitmap }, { transfer: [bitmap] });
      return;
    }
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: (err as Error).message });
  }
};

/** Una entrada del archivo abierto, lista para decodificar. */
async function read(name: string): Promise<Blob> {
  if (loose) {
    const blob = loose.get(name);
    if (!blob) throw new Error(`Entrada inexistente: ${name}`);
    return blob;
  }
  if (!archive) throw new Error("No hay archivo abierto");
  return new Blob([(await inflateOne(archive, name)) as BlobPart]);
}

/**
 * Lista el contenido sin descomprimir nada: el filtro de fflate se invoca con cada entrada
 * y devolver `false` evita inflarla. Solo se paga el parseo del índice del zip.
 */
function listAll(data: Uint8Array): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const found: string[] = [];
    unzip(
      data,
      {
        filter(file: UnzipFileInfo) {
          if (!file.name.endsWith("/")) found.push(file.name);
          return false;
        },
      },
      (err) => (err ? reject(err) : resolve(found)),
    );
  });
}

function inflateOne(data: Uint8Array, name: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    unzip(data, { filter: (f) => f.name === name }, (err, out) => {
      if (err) return reject(err);
      const bytes = out[name];
      if (!bytes) return reject(new Error(`Entrada ilegible: ${name}`));
      resolve(bytes);
    });
  });
}

/// <reference lib="webworker" />
import { unzip, type UnzipFileInfo } from "fflate";
import { isPage, sortPages } from "./entries";

/**
 * Worker de archivo: mantiene el CBZ comprimido en memoria y **infla una entrada a la vez**,
 * bajo demanda. Un tomo entero descomprimido serían cientos de MB; así solo vive el zip
 * original más las páginas que el reader tenga en vuelo.
 *
 * La decodificación a ImageBitmap también pasa acá, para no bloquear el hilo principal.
 */

let archive: Uint8Array | null = null;
let entries: string[] = [];

type Req =
  | { id: number; kind: "open"; buffer: ArrayBuffer }
  | { id: number; kind: "bitmap"; index: number };

self.onmessage = async (ev: MessageEvent<Req>) => {
  const msg = ev.data;
  try {
    if (msg.kind === "open") {
      archive = new Uint8Array(msg.buffer);
      entries = await listEntries(archive);
      if (entries.length === 0) throw new Error("El archivo no contiene imágenes");
      self.postMessage({ id: msg.id, ok: true, entries });
      return;
    }

    if (msg.kind === "bitmap") {
      if (!archive) throw new Error("No hay archivo abierto");
      const name = entries[msg.index];
      if (!name) throw new Error(`Página fuera de rango: ${msg.index}`);
      const bytes = await inflateOne(archive, name);
      // El tipo lo infiere el decodificador; no hace falta acertar el mime exacto.
      const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]));
      self.postMessage({ id: msg.id, ok: true, bitmap }, { transfer: [bitmap] });
      return;
    }
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: (err as Error).message });
  }
};

/**
 * Lista las páginas sin descomprimir nada: el filtro de fflate se invoca con cada entrada
 * y devolver `false` evita inflarla. Solo se paga el parseo del índice del zip.
 */
function listEntries(data: Uint8Array): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const found: string[] = [];
    unzip(
      data,
      {
        filter(file: UnzipFileInfo) {
          if (isPage(file.name)) found.push(file.name);
          return false;
        },
      },
      (err) => (err ? reject(err) : resolve(sortPages(found))),
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

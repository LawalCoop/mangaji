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
  | { id: number; kind: "bitmap"; index: number }
  | { id: number; kind: "text"; name: string };

self.onmessage = async (ev: MessageEvent<Req>) => {
  const msg = ev.data;
  try {
    if (msg.kind === "open") {
      archive = new Uint8Array(msg.buffer);
      const found = await listAll(archive);
      entries = sortPages(found.filter(isPage));
      if (entries.length === 0) throw new Error("El archivo no contiene imágenes");
      // Un `.cbza` trae manifest; un CBZ común, no. Es lo que decide el modo de lectura.
      self.postMessage({ id: msg.id, ok: true, entries, all: found });
      return;
    }

    if (msg.kind === "text") {
      if (!archive) throw new Error("No hay archivo abierto");
      const bytes = await inflateOne(archive, msg.name);
      self.postMessage({ id: msg.id, ok: true, text: new TextDecoder().decode(bytes) });
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

/// <reference lib="webworker" />
import { Detector } from "./detector";
import type { Note } from "./notes";
import { processPage, type ProcessedPage } from "./process";

/**
 * Worker de procesamiento: convierte páginas sueltas en material listo para leer.
 *
 * Vive fuera del hilo principal porque el trabajo pesado no es la inferencia sino lo que la
 * rodea —leer cuatro megapíxeles, trazar contornos, recortar el diálogo—, y eso es
 * JavaScript que bloquea. Acá no molesta a nadie: quien lee ya está mirando las páginas que
 * salieron antes, con la cámara moviéndose sin tirones.
 */

export type ProcessRequest =
  | { kind: "page"; index: number; bitmap: ImageBitmap }
  | { kind: "close" };

export type ProcessResponse =
  | { kind: "models"; note: Note }
  /** Cuánto de los modelos se bajó, de 0 a 1. */
  | { kind: "download"; fraction: number }
  | { kind: "progress"; index: number; note: Note }
  | { kind: "page"; page: ProcessedPage }
  | { kind: "error"; index: number; message: string };

let loading: Promise<Detector> | null = null;

function ready(): Promise<Detector> {
  loading ??= Detector.load(
    (note) => post({ kind: "models", note }),
    (fraction) => post({ kind: "download", fraction }),
  );
  return loading;
}

function post(msg: ProcessResponse, transfer: Transferable[] = []): void {
  self.postMessage(msg, transfer);
}

self.onmessage = async (ev: MessageEvent<ProcessRequest>) => {
  const msg = ev.data;

  if (msg.kind === "close") {
    if (loading) await (await loading).release();
    self.close();
    return;
  }

  try {
    const detector = await ready();
    const page = await processPage(detector, msg.bitmap, msg.index, (note) =>
      post({ kind: "progress", index: msg.index, note }),
    );
    msg.bitmap.close();

    // Los bytes se transfieren en vez de copiarse: son el arte de la página y sus sprites,
    // y quien los recibe es el único que los va a usar.
    post({ kind: "page", page }, [
      page.image.buffer as ArrayBuffer,
      ...Object.values(page.sprites).map((s) => s.buffer as ArrayBuffer),
    ]);
  } catch (error) {
    msg.bitmap.close();
    post({
      kind: "error",
      index: msg.index,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

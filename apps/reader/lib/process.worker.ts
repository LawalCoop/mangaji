/// <reference lib="webworker" />
import { Detector } from "./detector";
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
  | { kind: "models"; detail: string }
  | { kind: "progress"; index: number; detail: string }
  | { kind: "page"; page: ProcessedPage }
  | { kind: "error"; index: number; message: string };

let loading: Promise<Detector> | null = null;

function ready(): Promise<Detector> {
  loading ??= Detector.load((_, detail) => post({ kind: "models", detail: detail ?? "" }));
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
    const page = await processPage(detector, msg.bitmap, msg.index, (detail) =>
      post({ kind: "progress", index: msg.index, detail }),
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

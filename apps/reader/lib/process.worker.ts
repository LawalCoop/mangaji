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
  /** El tamaño del modelo de viñetas: más chico en las placas de video lentas. */
  | { kind: "panels"; size: number }
  /** La cámara se va a mover durante `ms`: las inferencias esperan a que termine. */
  | { kind: "motion"; ms: number }
  | { kind: "close" };

export type ProcessResponse =
  | { kind: "models"; note: Note }
  /** Cuánto de los modelos se bajó, de 0 a 1. */
  | { kind: "download"; fraction: number }
  | { kind: "progress"; index: number; note: Note }
  /** Cuánto tardó una inferencia y dónde corrió, para el diagnóstico (`?perf=on`). */
  | { kind: "timing"; model: "panels" | "text"; ms: number; size: number; backend: string }
  | { kind: "page"; page: ProcessedPage }
  | { kind: "error"; index: number; message: string };

let loading: Promise<Detector> | null = null;
/** El tamaño pedido para el modelo de viñetas; `undefined`, el de siempre. */
let panelSize: number | undefined;

function ready(): Promise<Detector> {
  loading ??= Detector.load(
    (note) => post({ kind: "models", note }),
    (fraction) => post({ kind: "download", fraction }),
    panelSize,
  );
  return loading;
}

function post(msg: ProcessResponse, transfer: Transferable[] = []): void {
  self.postMessage(msg, transfer);
}

/**
 * Hasta cuándo se mueve la cámara, en el reloj de este worker. Cada inferencia espera a que
 * pase, pero no más que QUIET_MAX_MS: si la lectura nunca se queda quieta, igual se avanza.
 */
let movingUntil = 0;
const QUIET_MAX_MS = 3000;

Detector.pause = async () => {
  const limit = performance.now() + QUIET_MAX_MS;
  for (;;) {
    const wait = Math.min(movingUntil, limit) - performance.now();
    if (wait <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
};

Detector.timing = (model, ms, size) =>
  post({ kind: "timing", model, ms, size, backend: model === "panels" ? Detector.backend : "wasm" });

/** La página en curso: al cerrar se espera a que termine antes de soltar los modelos. */
let current: Promise<unknown> = Promise.resolve();

self.onmessage = (ev: MessageEvent<ProcessRequest>) => {
  const msg = ev.data;

  if (msg.kind === "panels") {
    panelSize = msg.size;
    return;
  }

  if (msg.kind === "motion") {
    movingUntil = Math.max(movingUntil, performance.now() + msg.ms);
    return;
  }

  if (msg.kind === "close") {
    // Cortar a mitad de una inferencia en la placa de video puede dejar trabado el proceso de
    // la placa del navegador, y con él la página entera. Se termina lo que está en curso, se
    // sueltan los modelos y recién ahí se cierra.
    void current
      .catch(() => {})
      .then(async () => {
        if (loading) await (await loading).release();
      })
      .catch(() => {})
      .finally(() => self.close());
    return;
  }
  current = work(msg);
};

async function work(msg: Extract<ProcessRequest, { kind: "page" }>): Promise<void> {
  try {
    const detector = await ready();
    // Se pidió otro tamaño con los modelos ya cargados: se cambia acá, entre páginas.
    if (panelSize !== undefined && detector.panelSize !== panelSize) await detector.usePanels(panelSize);
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
}

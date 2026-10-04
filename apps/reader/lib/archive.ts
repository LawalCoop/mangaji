import { pageOfSprite } from "./live-archive";
import { ProblemError } from "./notes";
import { outOfReach } from "./memory";
/**
 * Acceso al archivo de manga desde el hilo principal.
 *
 * La interfaz existe para que el formato sea intercambiable: hoy CBZ con fflate, mañana
 * CBR/CBT con libarchive.js o BitJS, sin que el resto del reader se entere.
 */
export interface ArchiveSource {
  readonly pageCount: number;
  entryName(index: number): string;
  /** Entradas que no son páginas — el manifest de un `.cbza`, por ejemplo. */
  has(name: string): boolean;
  text(name: string): Promise<string>;
  /** Decodifica una entrada de imagen por nombre (los sprites de diálogo). */
  bitmapOf(name: string): Promise<ImageBitmap>;
  /** Decodifica (o devuelve de caché) la página. Cancelable cerrando la fuente. */
  bitmap(index: number): Promise<ImageBitmap>;
  /** Sugerencia de precarga; los errores se ignoran a propósito. */
  prefetch(index: number): void;
  /** Libera la página de la caché. Una página son ~4 MP: sin esto la memoria crece sin techo. */
  release(index: number): void;
  close(): void;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };


export class CbzSource implements ArchiveSource {
  #worker: Worker;
  #entries: string[] = [];
  #all = new Set<string>();
  #pending = new Map<number, Pending>();
  #seq = 0;
  #cache = new Map<number, Promise<ImageBitmap>>();
  /** Sprites de diálogo, cacheados por nombre. Son chicos y se reusan al volver atrás. */
  #named = new Map<string, Promise<ImageBitmap>>();
  #closed = false;

  private constructor(worker: Worker) {
    this.#worker = worker;
    this.#worker.onmessage = (ev: MessageEvent) => {
      const { id, ok, problem, ...rest } = ev.data;
      const p = this.#pending.get(id);
      if (!p) return;
      this.#pending.delete(id);
      ok ? p.resolve(rest) : p.reject(new ProblemError(problem));
    };
  }

  static async open(file: File | Blob): Promise<CbzSource> {
    const worker = new Worker(new URL("./archive.worker.ts", import.meta.url), {
      type: "module",
    });
    const source = new CbzSource(worker);

    // Un CBR es un RAR: libarchive lo descomprime acá y al worker le llegan las páginas
    // sueltas. Antes se reempaquetaba como ZIP para que el worker hablara un solo formato,
    // y eso eran tres o cuatro copias del tomo en memoria a la vez —lo que en un celular
    // termina con la pestaña cerrada—. Las páginas viajan como `Blob`, sin copiar bytes.
    const { isRar, readRar } = await import("./rar");
    const opened = (await isRar(file))
      ? await readRar(file as File).then((pages) => {
          if (!pages.length) throw new ProblemError({ code: "noImages" });
          return source.#send({
            kind: "openFiles",
            files: pages.map((p) => ({ name: p.name, blob: p.file })),
          });
        })
      : await file.arrayBuffer().then((buffer) => source.#send({ kind: "open", buffer }, [buffer]));
    const { entries, all } = opened as { entries: string[]; all: string[] };
    source.#entries = entries;
    source.#all = new Set(all);
    return source;
  }

  get pageCount(): number {
    return this.#entries.length;
  }

  entryName(index: number): string {
    return this.#entries[index] ?? "";
  }

  has(name: string): boolean {
    return this.#all.has(name);
  }

  async text(name: string): Promise<string> {
    const { text } = (await this.#send({ kind: "text", name })) as { text: string };
    return text;
  }

  async bitmapOf(name: string): Promise<ImageBitmap> {
    const cached = this.#named.get(name);
    if (cached) return cached;
    const task = this.#send({ kind: "bitmapOf", name }).then(
      (r) => (r as { bitmap: ImageBitmap }).bitmap,
    );
    this.#named.set(name, task);
    task.catch(() => this.#named.delete(name));
    return task;
  }

  bitmap(index: number): Promise<ImageBitmap> {
    const hit = this.#cache.get(index);
    if (hit) return hit;

    const task = this.#send({ kind: "bitmap", index }).then(
      (r) => (r as { bitmap: ImageBitmap }).bitmap,
    );
    this.#cache.set(index, task);
    // Un fallo no debe envenenar la caché: el próximo intento vuelve a pedirla.
    task.catch(() => this.#cache.delete(index));
    this.#evictAround(index);
    return task;
  }

  prefetch(index: number): void {
    if (index < 0 || index >= this.pageCount || this.#cache.has(index)) return;
    void this.bitmap(index).catch(() => {});
  }

  release(index: number): void {
    const task = this.#cache.get(index);
    if (!task) return;
    this.#cache.delete(index);
    void task.then((b) => b.close()).catch(() => {});
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const task of this.#named.values()) void task.then((b) => b.close()).catch(() => {});
    this.#named.clear();
    for (const i of [...this.#cache.keys()]) this.release(i);
    for (const p of this.#pending.values()) p.reject(new Error("Archivo cerrado"));
    this.#pending.clear();
    this.#worker.terminate();
  }

  /** Descarta lo que quedó lejos de donde está mirando el lector. */
  #evictAround(index: number): void {
    for (const i of [...this.#cache.keys()]) {
      if (outOfReach(i, index)) this.release(i);
    }
    // Los globos también: decodificados y acumulados durante todo el tomo, dejaban al
    // celular sin memoria.
    for (const [name, task] of this.#named) {
      const page = pageOfSprite(name);
      if (page !== null && outOfReach(page, index)) {
        this.#named.delete(name);
        void task.then((b) => b.close()).catch(() => {});
      }
    }
  }

  #send(payload: Record<string, unknown>, transfer: Transferable[] = []): Promise<unknown> {
    if (this.#closed) return Promise.reject(new Error("Archivo cerrado"));
    const id = ++this.#seq;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#worker.postMessage({ id, ...payload }, transfer);
    });
  }
}

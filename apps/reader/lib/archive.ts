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

/**
 * Reempaqueta un CBR como ZIP en memoria.
 *
 * Así el resto del lector no se entera del formato: descomprimir RAR pasa una sola vez, al
 * abrir, y de ahí en más todo funciona igual. Se guarda sin comprimir porque las páginas ya
 * son JPG o PNG y volver a comprimirlas no ahorra nada.
 */
async function rezip(file: File): Promise<Blob> {
  const [{ readRar }, { zipSync }] = await Promise.all([import("./rar"), import("fflate")]);
  const pages = await readRar(file);
  if (!pages.length) throw new Error("El CBR no contiene imágenes");

  const files: Record<string, Uint8Array> = {};
  for (const page of pages) {
    files[page.name] = new Uint8Array(await page.file.arrayBuffer());
  }
  return new Blob([zipSync(files, { level: 0 }) as unknown as BlobPart]);
}

/** Cuántas páginas decodificadas se mantienen vivas alrededor de la actual. */
const CACHE_LIMIT = 5;

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
      const { id, ok, error, ...rest } = ev.data;
      const p = this.#pending.get(id);
      if (!p) return;
      this.#pending.delete(id);
      ok ? p.resolve(rest) : p.reject(new Error(error));
    };
  }

  static async open(file: File | Blob): Promise<CbzSource> {
    const worker = new Worker(new URL("./archive.worker.ts", import.meta.url), {
      type: "module",
    });
    const source = new CbzSource(worker);

    // Un CBR es un RAR y el worker solo entiende ZIP: se convierte antes, una sola vez.
    const { isRar } = await import("./rar");
    const input = (await isRar(file)) ? await rezip(file as File) : file;
    const buffer = await input.arrayBuffer();
    const { entries, all } = (await source.#send({ kind: "open", buffer }, [buffer])) as {
      entries: string[];
      all: string[];
    };
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
      if (Math.abs(i - index) > CACHE_LIMIT) this.release(i);
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

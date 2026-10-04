import { MANIFEST_FILENAME, type Manifest } from "@mangaji/format";
import type { ArchiveSource } from "./archive";
import { pageOfSprite } from "./live-archive";
import { directionOf, outOfReach, type Direction } from "./memory";


/**
 * Un tomo ya procesado que vive en un servidor: el manifest, el arte sin diálogo y los
 * globos, cada uno en su URL. Es lo que lee el portal de una editorial; nada se procesa en
 * el dispositivo, así que abre apenas llega el manifest.
 *
 * `url` arma la dirección de cada archivo: así quien la usa puede firmarlas o cambiarlas sin
 * que el lector se entere.
 */
export class RemoteSource implements ArchiveSource {
  #manifest: Manifest;
  #url: (name: string) => string;
  #names: Set<string>;
  #cache = new Map<number, Promise<ImageBitmap>>();
  /** La página que se está leyendo, y hacia dónde se viene leyendo. */
  #current = 0;
  #direction: Direction = 1;
  #named = new Map<string, Promise<ImageBitmap>>();
  #abort = new AbortController();

  constructor(manifest: Manifest, url: (name: string) => string) {
    this.#manifest = manifest;
    this.#url = url;
    this.#names = new Set([
      MANIFEST_FILENAME,
      ...manifest.pages.map((p) => p.image),
      ...manifest.pages.flatMap((p) => p.panels.flatMap((q) => q.balloons.map((b) => b.sprite))).filter(Boolean),
    ]);
  }

  get pageCount(): number {
    return this.#manifest.pages.length;
  }

  entryName(index: number): string {
    return this.#manifest.pages[index]?.image ?? "";
  }

  has(name: string): boolean {
    return this.#names.has(name);
  }

  async text(name: string): Promise<string> {
    if (name === MANIFEST_FILENAME) return JSON.stringify(this.#manifest);
    const res = await fetch(this.#url(name), { signal: this.#abort.signal });
    if (!res.ok) throw new Error(`No se pudo leer ${name} (${res.status})`);
    return res.text();
  }

  async #decode(name: string): Promise<ImageBitmap> {
    const res = await fetch(this.#url(name), { signal: this.#abort.signal });
    if (!res.ok) throw new Error(`No se pudo leer ${name} (${res.status})`);
    return createImageBitmap(await res.blob());
  }

  bitmapOf(name: string): Promise<ImageBitmap> {
    const cached = this.#named.get(name);
    if (cached) return cached;
    const task = this.#decode(name);
    this.#named.set(name, task);
    task.catch(() => this.#named.delete(name));
    return task;
  }

  /** La página que se va a mostrar: también marca dónde se está leyendo, para saber qué soltar. */
  bitmap(index: number): Promise<ImageBitmap> {
    this.#direction = directionOf(index, this.#current, this.#direction);
    this.#current = index;
    this.#evictAround(index);
    return this.#load(index);
  }

  /** Decodifica la página, o la devuelve de la caché si sigue viva. */
  #load(index: number): Promise<ImageBitmap> {
    const hit = this.#cache.get(index);
    // Una imagen cerrada —la soltó quien la usaba— tiene ancho cero: se decodifica de nuevo.
    if (hit) return hit.then((b) => (b.width > 0 ? b : (this.#cache.delete(index), this.#load(index))));
    const task = this.#decode(this.entryName(index));
    this.#cache.set(index, task);
    task.catch(() => this.#cache.delete(index));
    return task;
  }

  /**
   * Prepara una página antes de llegar. No suelta nada: lo que se suelta se decide por la
   * página que se lee, no por la que se prepara (preparando la que viene se soltaba la que
   * estaba a la vista).
   */
  prefetch(index: number): void {
    if (index < 0 || index >= this.pageCount || this.#cache.has(index)) return;
    if (outOfReach(index, this.#current, this.#direction)) return;
    void this.#load(index).catch(() => {});
  }

  release(index: number): void {
    const task = this.#cache.get(index);
    if (!task) return;
    this.#cache.delete(index);
    void task.then((b) => b.close()).catch(() => {});
  }

  close(): void {
    this.#abort.abort();
    for (const task of this.#named.values()) void task.then((b) => b.close()).catch(() => {});
    this.#named.clear();
    for (const i of [...this.#cache.keys()]) this.release(i);
  }

  /** Lo que quedó lejos de donde se está leyendo se suelta, páginas y globos. */
  #evictAround(index: number): void {
    for (const i of [...this.#cache.keys()]) {
      if (outOfReach(i, index, this.#direction)) this.release(i);
    }
    for (const [name, task] of this.#named) {
      const page = pageOfSprite(name);
      if (page !== null && outOfReach(page, index, this.#direction)) {
        this.#named.delete(name);
        void task.then((b) => b.close()).catch(() => {});
      }
    }
  }
}

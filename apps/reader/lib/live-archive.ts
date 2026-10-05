import type { ArchiveSource } from "./archive";
import type { ProcessedPage } from "./process";
import type { ShelvedPage } from "./shelf";
import { directionOf, outOfReach, type Direction } from "./memory";

/**
 * Un archivo que todavía se está escribiendo.
 *
 * Sirve las páginas que ya salieron del worker mientras el resto se procesa, para que leer
 * no tenga que esperar al tomo entero: la primera página está lista en un par de segundos y
 * a partir de ahí el lector nunca alcanza al procesador —leer una viñeta dirigida lleva más
 * que procesarla—.
 *
 * Cumple el mismo contrato que `CbzSource`, así que el reader no distingue entre leer un
 * `.cbza` terminado y leer uno que se está cocinando.
 */


export class LiveSource implements ArchiveSource {
  #pages: (ProcessedPage | ShelvedPage)[] = [];
  /** Los bytes de cada entrada, o la porción del archivo guardado donde están. */
  #bytes = new Map<string, Uint8Array | Blob>();
  #cache = new Map<number, Promise<ImageBitmap>>();
  /** La página que se está leyendo, y hacia dónde se viene leyendo. */
  #current = 0;
  #direction: Direction = 1;
  #named = new Map<string, Promise<ImageBitmap>>();
  #closed = false;

  /** Incorpora una página recién procesada. Llegan en orden. */
  add(page: ProcessedPage | ShelvedPage): void {
    this.#pages[page.index] = page;
    this.#bytes.set(`pages/${page.id}.webp`, page.image);
    for (const [name, data] of Object.entries(page.sprites)) this.#bytes.set(name, data);
  }

  /** Todo lo procesado hasta ahora, para armar el `.cbza` al terminar. */
  get pages(): (ProcessedPage | ShelvedPage)[] {
    return this.#pages;
  }

  get pageCount(): number {
    return this.#pages.length;
  }

  entryName(index: number): string {
    const page = this.#pages[index];
    return page ? `pages/${page.id}.webp` : "";
  }

  has(name: string): boolean {
    return this.#bytes.has(name);
  }

  async text(): Promise<string> {
    throw new Error("Un archivo en curso no tiene manifest todavía");
  }

  bitmapOf(name: string): Promise<ImageBitmap> {
    const cached = this.#named.get(name);
    if (cached) return cached;

    const bytes = this.#bytes.get(name);
    if (!bytes) return Promise.reject(new Error(`No está listo: ${name}`));

    const task = createImageBitmap(bytes instanceof Blob ? bytes : new Blob([bytes as unknown as BlobPart]));
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

  peek(index: number): Promise<ImageBitmap> {
    return this.#load(index);
  }

  /** Decodifica la página, o la devuelve de la caché si sigue viva. */
  #load(index: number): Promise<ImageBitmap> {
    const hit = this.#cache.get(index);
    // Una imagen cerrada —la soltó quien la usaba— tiene ancho cero: se decodifica de nuevo.
    if (hit) return hit.then((b) => (b.width > 0 ? b : (this.#cache.delete(index), this.#load(index))));

    const bytes = this.#bytes.get(this.entryName(index));
    if (!bytes) return Promise.reject(new Error(`La página ${index + 1} todavía no está lista`));

    const task = createImageBitmap(bytes instanceof Blob ? bytes : new Blob([bytes as unknown as BlobPart]));
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
    if (this.#closed) return;
    this.#closed = true;
    for (const task of this.#named.values()) void task.then((b) => b.close()).catch(() => {});
    this.#named.clear();
    for (const i of [...this.#cache.keys()]) this.release(i);
  }

  /**
   * Descarta lo que quedó lejos de donde está mirando el lector: las páginas y también los
   * globos, que antes se acumulaban decodificados durante todo el tomo.
   */
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

/** La página (desde 0) de un globo, por su nombre: `sprites/p012.b3.png` es de la 12. */
export function pageOfSprite(name: string): number | null {
  const m = /\/p(\d+)\./.exec(name);
  return m ? Number(m[1]) - 1 : null;
}

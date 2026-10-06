import type { Beat } from "@mangaji/format";
import type { Frame, FrameSource } from "./types";

/**
 * Motor de reproducción: decide qué encuadre se ve y cuándo se dispara cada beat.
 *
 * Es deliberadamente puro — no conoce Pixi, ni el DOM, ni imágenes — para poder testearlo
 * headless y para que v2..v5 lo reutilicen sin tocarlo. Lo único que cambia entre versiones
 * es el FrameSource que recibe y la riqueza de los beats.
 */

export type DirectorEvent =
  | { type: "frame"; frame: Frame; index: number; immediate: boolean }
  | { type: "beat"; beat: Beat; frame: Frame }
  /** Se acabó lo que hay procesado, pero el tomo sigue. */
  | { type: "waiting" }
  | { type: "end" };

type Listener = (ev: DirectorEvent) => void;

export type DirectorOptions = {
  autoplay?: boolean;
  /** Con `prefers-reduced-motion` el consumidor corta en vez de animar. */
  reducedMotion?: boolean;
  /** Duración de un frame sin beats, en ms. */
  defaultHold?: number;
};

/** Cuánto dura un frame: el final del último beat. */
export function frameDuration(frame: Frame, fallback: number): number {
  if (frame.beats.length === 0) return fallback;
  return frame.beats.reduce((end, b) => Math.max(end, b.t + b.ms + (b.hold ?? 0)), 0);
}

export class Director {
  #source: FrameSource;
  #listeners = new Set<Listener>();
  #index = 0;
  #elapsed = 0;
  #fired = 0;
  #playing: boolean;
  /** Se llegó al borde de lo procesado y se espera a que aparezca lo que sigue. */
  #waiting = false;

  readonly reducedMotion: boolean;
  /**
   * Se consulta al avanzar. Si devuelve true, ese avance se usa para otra cosa —terminar un
   * movimiento de cámara— y no se revela ni se pasa de encuadre.
   */
  holdNext?: () => boolean;
  /**
   * Reproducción sola: si todavía no se puede pasar —la cámara está recorriendo la viñeta—,
   * se espera en vez de cortarla.
   */
  canAdvance?: () => boolean;
  /**
   * Cuánto se queda cada encuadre al reproducir solo. Los tiempos de los beats están pensados
   * para tocar —se lee más rápido de lo que se escribe—; solo, hace falta más para leer.
   */
  playDuration: (frame: Frame) => number = (frame) => frameDuration(frame, this.defaultHold);
  readonly defaultHold: number;

  constructor(source: FrameSource, opts: DirectorOptions = {}) {
    this.#source = source;
    this.#playing = opts.autoplay ?? false;
    this.reducedMotion = opts.reducedMotion ?? false;
    this.defaultHold = opts.defaultHold ?? 4000;
  }

  get index(): number {
    return this.#index;
  }
  get length(): number {
    return this.#source.length;
  }
  /** El encuadre en la posición `i`, sin moverse. */
  frameAt(i: number): Frame {
    return this.#source.at(i);
  }
  get frame(): Frame {
    return this.#source.at(this.#index);
  }
  get label(): string {
    return this.#source.label(this.#index);
  }
  get playing(): boolean {
    return this.#playing;
  }

  /** Encuadre que viene `offset` posiciones más adelante, para precargar lo que usará. */
  peek(offset: number): Frame | null {
    const i = this.#index + offset;
    return i >= 0 && i < this.#source.length ? this.#source.at(i) : null;
  }

  /**
   * Todos los encuadres de una página, en orden.
   *
   * El diálogo se pone por página y no por viñeta: lo que ya se leyó tiene que seguir en
   * su globo cuando la cámara viaja a la viñeta siguiente.
   */
  framesOfPage(page: number): Frame[] {
    const out: Frame[] = [];
    for (let i = 0; i < this.#source.length; i++) {
      const frame = this.#source.at(i);
      if (frame.page === page) out.push(frame);
      else if (out.length) break; // los de una página son contiguos
    }
    return out;
  }

  on(fn: Listener): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  /**
   * Cambiar de modo (página completa ↔ viñeta) es cambiar de fuente. Nada más.
   * `keepPage` mantiene al lector en la misma página aunque cambie la granularidad.
   */
  setSource(source: FrameSource, keepPage = true): void {
    const page = keepPage ? this.frame.page : 0;
    this.#source = source;
    let next = 0;
    for (let i = 0; i < source.length; i++) {
      if (source.at(i).page === page) {
        next = i;
        break;
      }
    }
    this.seek(next, true);
  }

  /** Salta al primer encuadre de una página. */
  seekToPage(page: number): void {
    for (let i = 0; i < this.#source.length; i++) {
      if (this.#source.at(i).page === page) {
        this.seek(i);
        return;
      }
    }
  }

  /** Salta a un encuadre por su página e id; si no está (otro modo de lectura), a la página. */
  seekToFrame(page: number, id: string): void {
    for (let i = 0; i < this.#source.length; i++) {
      const f = this.#source.at(i);
      if (f.page === page && f.id === id) {
        this.seek(i);
        return;
      }
    }
    this.seekToPage(page);
  }

  /** Cuántos encuadres tiene la página actual, y cuál se está viendo. */
  get positionInPage(): { index: number; total: number } {
    const page = this.frame.page;
    let total = 0;
    let index = 0;
    for (let i = 0; i < this.#source.length; i++) {
      if (this.#source.at(i).page !== page) continue;
      total++;
      if (i === this.#index) index = total;
    }
    return { index, total };
  }

  seek(index: number, immediate = false): void {
    const clamped = Math.min(Math.max(index, 0), this.#source.length - 1);
    this.#index = clamped;
    this.#elapsed = 0;
    this.#fired = 0;
    this.#waiting = false;
    this.#emit({ type: "frame", frame: this.frame, index: clamped, immediate });
  }

  /**
   * Avance del usuario: adelanta el diálogo que falta, y si no falta ninguno pasa de
   * encuadre.
   *
   * Cada toque revela un globo, no todos: quien toca quiere leer más rápido, no saltearse
   * lo que sigue. Y cuando ya está todo a la vista, el toque avanza en lugar de perderse
   * —que era lo que obligaba a tocar dos veces—.
   */
  next(): void {
    // Quien mira puede pedir que este avance se use para otra cosa: la cámara que todavía
    // está recorriendo la viñeta la muestra entera primero, con todo su diálogo.
    if (this.holdNext?.()) return;

    const beats = this.frame.beats;
    const pending = beats.findIndex((b, i) => i >= this.#fired && b.reveal !== undefined);

    if (pending >= 0) {
      this.#elapsed = Math.max(this.#elapsed, beats[pending].t);
      this.#fireUpTo(this.#elapsed);
      return;
    }

    // Sin diálogo pendiente: se completan los beats que queden (cámara, pausas) y se pasa.
    this.#fireUpTo(Number.POSITIVE_INFINITY);

    if (this.#index >= this.#source.length - 1) {
      // Con el archivo todavía en proceso, esto no es el final del tomo sino el borde de lo
      // que hay listo: se espera ahí y se sigue solo cuando aparezca la página siguiente.
      if (this.#source.complete === false) {
        if (!this.#waiting) {
          this.#waiting = true;
          this.#emit({ type: "waiting" });
        }
        return;
      }
      this.#playing = false;
      this.#emit({ type: "end" });
      return;
    }
    this.seek(this.#index + 1);
  }

  /** Muestra de una todo el diálogo que falta del encuadre actual, sin pasar al siguiente. */
  revealAll(): void {
    const last = this.frame.beats.reduce((t, b) => (b.reveal !== undefined ? Math.max(t, b.t) : t), -1);
    if (last < 0) return;
    this.#elapsed = Math.max(this.#elapsed, last);
    this.#fireUpTo(this.#elapsed);
  }

  /** La fuente incorporó encuadres nuevos: si se estaba esperando por ellos, se sigue. */
  grew(): void {
    if (!this.#waiting || this.#index >= this.#source.length - 1) return;
    this.#waiting = false;
    this.seek(this.#index + 1);
  }

  get waiting(): boolean {
    return this.#waiting;
  }

  prev(): void {
    if (this.#index <= 0) return;
    this.seek(this.#index - 1);
  }

  play(): void {
    this.#playing = true;
  }
  pause(): void {
    this.#playing = false;
  }
  toggle(): void {
    this.#playing = !this.#playing;
  }

  /** Avanza el reloj. Llamar desde el ticker del render, con el delta en ms. */
  tick(dtMs: number): void {
    this.#elapsed += dtMs;
    this.#fireUpTo(this.#elapsed);
    if (!this.#playing || this.#waiting) return;
    if (this.canAdvance && !this.canAdvance()) return;
    if (this.#elapsed >= this.playDuration(this.frame)) this.next();
  }

  #fireUpTo(t: number): void {
    const beats = this.frame.beats;
    while (this.#fired < beats.length && beats[this.#fired].t <= t) {
      this.#emit({ type: "beat", beat: beats[this.#fired], frame: this.frame });
      this.#fired++;
    }
  }

  #emit(ev: DirectorEvent): void {
    for (const fn of this.#listeners) fn(ev);
  }
}

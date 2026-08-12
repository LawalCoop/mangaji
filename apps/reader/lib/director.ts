import type { Beat } from "@manganime/format";
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

  readonly reducedMotion: boolean;
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
  get frame(): Frame {
    return this.#source.at(this.#index);
  }
  get label(): string {
    return this.#source.label(this.#index);
  }
  get playing(): boolean {
    return this.#playing;
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

  seek(index: number, immediate = false): void {
    const clamped = Math.min(Math.max(index, 0), this.#source.length - 1);
    this.#index = clamped;
    this.#elapsed = 0;
    this.#fired = 0;
    this.#emit({ type: "frame", frame: this.frame, index: clamped, immediate });
  }

  /**
   * Avance del usuario. Si el encuadre todavía tiene beats sin disparar los completa de
   * golpe y se queda; recién el siguiente avanza. Así un tap nunca "se pierde": o completa
   * lo que estaba pasando, o pasa al que sigue.
   */
  next(): void {
    if (this.#fired < this.frame.beats.length) {
      this.#fireUpTo(Number.POSITIVE_INFINITY);
      this.#elapsed = frameDuration(this.frame, this.defaultHold);
      return;
    }
    if (this.#index >= this.#source.length - 1) {
      this.#playing = false;
      this.#emit({ type: "end" });
      return;
    }
    this.seek(this.#index + 1);
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
    if (!this.#playing) return;
    if (this.#elapsed >= frameDuration(this.frame, this.defaultHold)) this.next();
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

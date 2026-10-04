import type { Rect } from "./types";

export type Viewport = { w: number; h: number };
/** Transformación a aplicar al contenedor del mundo. */
export type Transform = { x: number; y: number; scale: number };

const EPS = 0.0005;

/**
 * Encuadra rectángulos de la página dentro del viewport, con letterbox y easing.
 *
 * v1 la usa para "ajustar la página a pantalla" más zoom y paneo manual; v2 le pasa el rect
 * de cada viñeta y aparecen los movimientos de cámara. Es la misma cámara: lo único que
 * cambia es qué rect recibe.
 */
export class Camera {
  #current: Transform = { x: 0, y: 0, scale: 1 };
  #target: Transform = { x: 0, y: 0, scale: 1 };
  /** 0 = sin movimiento (corte seco). Sube con la duración del beat. */
  #smoothing = 0;

  /** Sacudida en curso: amplitud actual y cuánto le queda. */
  #shake = { amp: 0, left: 0, total: 1 };

  get transform(): Transform {
    if (this.#shake.left <= 0) return this.#current;
    // Decae hacia el final para que el golpe se sienta seco y se asiente solo.
    const k = this.#shake.left / this.#shake.total;
    const amp = this.#shake.amp * k * k;
    return {
      x: this.#current.x + (Math.random() * 2 - 1) * amp,
      y: this.#current.y + (Math.random() * 2 - 1) * amp,
      scale: this.#current.scale,
    };
  }

  /** Sacude la cámara. `amp` en píxeles de pantalla. */
  shake(amp: number, ms: number): void {
    this.#shake = { amp, left: ms, total: Math.max(ms, 1) };
  }


  /** Encuadre que contiene `rect` completo, centrado. `zoom` > 1 lo acerca. */
  static fit(rect: Rect, view: Viewport, zoom = 1): Transform {
    const scale = Math.min(view.w / rect.w, view.h / rect.h) * zoom;
    return {
      scale,
      x: view.w / 2 - (rect.x + rect.w / 2) * scale,
      y: view.h / 2 - (rect.y + rect.h / 2) * scale,
    };
  }

  // Se probó limitar el encuadre a los bordes de la hoja, para no mostrar fuera de la
  // página. No hace falta: el fondo toma el tono del papel, así que salirse se lee como si
  // la página continuara, y limitar descentraba la viñeta sin necesidad.

  /** Salta sin animar. Para cortes y para el primer encuadre. */
  cut(t: Transform): void {
    this.#current = { ...t };
    this.#target = { ...t };
    this.#smoothing = 0;
  }


  /**
   * Se mueve hacia `t`. `ms` es la duración nominal del movimiento; 0 equivale a un corte.
   */
  glide(t: Transform, ms: number): void {
    this.#target = { ...t };
    this.#smoothing = Math.max(0, ms);
    if (ms <= 0) this.cut(t);
  }

  /** Desplazamiento manual del usuario: aplica sobre ambos para que no se deshaga solo. */
  nudge(dx: number, dy: number): void {
    this.#current.x += dx;
    this.#current.y += dy;
    this.#target.x += dx;
    this.#target.y += dy;
  }

  /** Zoom manual anclado en un punto del viewport (la posición del cursor). */
  zoomAt(factor: number, px: number, py: number, limits = { min: 0.05, max: 8 }): void {
    // Los límites solo frenan: si la cámara ya estaba más allá —una viñeta chica encuadrada de
    // cerca—, acercar no la tira para atrás ni alejar la empuja para adelante.
    const cur = this.#current.scale;
    const next =
      factor > 1 ? Math.min(cur * factor, Math.max(limits.max, cur)) : Math.max(cur * factor, Math.min(limits.min, cur));
    const k = next / this.#current.scale;
    this.#current.x = px - (px - this.#current.x) * k;
    this.#current.y = py - (py - this.#current.y) * k;
    this.#current.scale = next;
    this.#target = { ...this.#current };
  }

  /** Interpolación exponencial: independiente del framerate, sin overshoot. */
  update(dtMs: number): boolean {
    if (this.#shake.left > 0) this.#shake.left -= dtMs;

    if (this.#smoothing <= 0) return this.#shake.left > 0;
    // 5 constantes de tiempo ≈ 99 % del recorrido dentro de la duración nominal.
    const k = 1 - Math.exp((-5 * dtMs) / this.#smoothing);
    const c = this.#current;
    const t = this.#target;
    c.x += (t.x - c.x) * k;
    c.y += (t.y - c.y) * k;
    c.scale += (t.scale - c.scale) * k;

    const done =
      Math.abs(t.x - c.x) < 0.1 && Math.abs(t.y - c.y) < 0.1 && Math.abs(t.scale - c.scale) < EPS;
    if (done) this.cut(t);
    return true;
  }
}

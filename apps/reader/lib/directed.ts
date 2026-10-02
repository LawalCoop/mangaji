import { Camera, type Transform, type Viewport } from "./camera";
import type { Rect } from "./types";

/** El margen con que se encuadra una viñeta entera; el mismo que usa el lector. */
export const FIT_MARGIN = 0.94;

/**
 * La cámara experimental para una viñeta, según su tensión (0 a 1).
 *
 * Reglas de cine tomadas de DynamicManga: una escena tensa entra de golpe y desde cerca, con
 * la cámara en mano; una tranquila se abre despacio; un plano ancho y calmo se recorre de
 * derecha a izquierda, como se lee, antes de mostrarse entero. El ritmo de lectura también
 * cambia: lo tenso se lee más rápido, lo calmo con más aire.
 */
export function directedShot(frame: ShotFrame, view: Viewport): DirectedShot {
  const { rect } = frame;
  const tension = frame.tension ?? 0;
  const fit = (zoom: number) => Camera.fit(rect, view, FIT_MARGIN * zoom);
  const to = fit(1);
  const speed = 1.45 - 0.8 * tension;
  const move = (ms: number) => [{ to, ms: ms * speed, at: 0 }];

  // Si mostrarla entera la deja chica —una viñeta muy ancha o muy alta en una pantalla de la
  // otra forma, como un celular parado—, se recorre de cerca y recién al final se muestra
  // entera. Las anchas, de derecha a izquierda, como se lee; las altas, de arriba a abajo.
  const fitScale = Math.min(view.w / rect.w, view.h / rect.h);
  const coverScale = Math.max(view.w / rect.w, view.h / rect.h);
  if (coverScale / fitScale >= PAN.minGain) {
    const scale = Math.min(coverScale * FIT_MARGIN, fitScale * PAN.maxZoom);
    const wide = rect.w * scale > view.w;
    const cx = view.w / 2 - (rect.x + rect.w / 2) * scale;
    const cy = view.h / 2 - (rect.y + rect.h / 2) * scale;
    const pad = 0.03 * Math.min(view.w, view.h);
    const start: Transform = wide
      ? { scale, x: view.w - pad - (rect.x + rect.w) * scale, y: cy }
      : { scale, x: cx, y: pad - rect.y * scale };
    const end: Transform = wide
      ? { scale, x: pad - rect.x * scale, y: cy }
      : { scale, x: cx, y: view.h - pad - (rect.y + rect.h) * scale };
    // Centrar un punto de la viñeta sin salirse del recorrido.
    const lo = Math.min(wide ? start.x : start.y, wide ? end.x : end.y);
    const hi = Math.max(wide ? start.x : start.y, wide ? end.x : end.y);
    const aim = (r: Rect): Transform => {
      const c = wide ? view.w / 2 - (r.x + r.w / 2) * scale : view.h / 2 - (r.y + r.h / 2) * scale;
      const v = Math.min(hi, Math.max(lo, c));
      return wide ? { scale, x: v, y: cy } : { scale, x: cx, y: v };
    };
    const shake = tension >= 0.55 ? 2 + 4 * tension : 0;

    // Paneo continuo: a velocidad pareja de punta a punta, pero sin pasar un globo que
    // todavía no apareció. Dura lo que tarda en aparecer el diálogo, o lo que recorre si no
    // hay. Al terminar, se muestra la viñeta entera.
    const span = (wide ? end.x - start.x : end.y - start.y) || 1;
    const along = (t: Transform) => ((wide ? t.x - start.x : t.y - start.y) / span);
    const layers = new Map((frame.layers ?? []).map((l) => [l.id, l.rect]));
    const stops = frame.beats
      .filter((b) => b.reveal && layers.has(b.reveal))
      .map((b) => ({ id: b.reveal!, at: Math.min(1, Math.max(0, along(aim(layers.get(b.reveal!)!)))) }));
    const travel = wide ? (rect.w * scale - view.w) / view.w : (rect.h * scale - view.h) / view.h;
    const travelMs = Math.min(PAN.maxMs, PAN.baseMs + travel * PAN.perScreenMs) * speed;
    const dialogueMs = Math.max(0, ...frame.beats.map((b) => b.t ?? 0));
    return {
      from: start,
      steps: [],
      pan: { start, end, ms: Math.max(travelMs, dialogueMs * 1.15), stops },
      final: to,
      shake,
      pace: 1.15,
    };
  }

  if (tension >= 0.55) {
    return { from: fit(1.2), steps: move(900), final: to, shake: 2 + 5 * tension, pace: 0.85 };
  }
  if (rect.w / rect.h >= 1.8 && tension < 0.45) {
    // Plano de ubicación: arranca en el tercio derecho y se abre a la viñeta entera.
    const part = { x: rect.x + rect.w * 0.45, y: rect.y, w: rect.w * 0.55, h: rect.h };
    return { from: Camera.fit(part, view, FIT_MARGIN), steps: move(1440), final: to, shake: 0, pace: 1.1 };
  }
  if (tension <= 0.25) {
    return { from: fit(0.93), steps: move(1080), final: to, shake: 0, pace: 1.15 };
  }
  return { from: fit(1.07), steps: move(900), final: to, shake: 0, pace: 1 };
}

/** Lo que el plano necesita saber de la viñeta. */
export type ShotFrame = {
  rect: Rect;
  tension?: number;
  beats: { t?: number; reveal?: string; hold?: number }[];
  layers?: { id: string; rect: Rect }[];
};

/** Un tramo del plano, que arranca a los `at` ms de empezar la viñeta. */
export type ShotStep = { to: Transform; ms: number; at?: number };

/** Un paneo continuo de `start` a `end` en `ms`, que no pasa un globo antes de que aparezca. */
export type Pan = { start: Transform; end: Transform; ms: number; stops: { id: string; at: number }[] };

/** Un plano de la cámara experimental: dónde arranca y los tramos que recorre. */
export type DirectedShot = {
  from: Transform;
  steps: ShotStep[];
  /** Si la viñeta se recorre: el paneo. */
  pan?: Pan;
  /** Dónde queda la cámara al final del plano: la viñeta entera. */
  final: Transform;
  shake: number;
  /** Ritmo de lectura de la viñeta: más de 1, más lento. */
  pace: number;
};

/**
 * El paneo de las viñetas que enteras quedan chicas: desde cuánto se achican para que valga
 * la pena (`minGain`: entera ocuparía menos de un tercio de lo que podría), cuánto puede
 * acercarse como mucho y cuánto dura según lo que recorre.
 */
const PAN = { minGain: 3, maxZoom: 2.4, baseMs: 2600, perScreenMs: 2200, maxMs: 9000 };

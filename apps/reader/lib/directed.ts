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

    // Con diálogo, la cámara va de globo en globo a medida que aparecen —esperando o tocando—
    // y termina de recorrer y se aleja cuando ya se leyó todo. Sin diálogo, un paneo de
    // duración fija según lo que recorre.
    const reveals = frame.beats.filter((b) => b.reveal).map((b) => b.reveal!);
    const layers = new Map((frame.layers ?? []).map((l) => [l.id, l.rect]));
    const stops = reveals.filter((id) => layers.has(id));
    if (stops.length) {
      return {
        from: start,
        steps: [
          ...stops.map((id, i) => ({ to: aim(layers.get(id)!), ms: PAN.stopMs, on: id, shake: i === 0 ? shake : 0 })),
          { to: end, ms: PAN.stopMs, on: HOLD },
          { to, ms: 800, on: HOLD, after: PAN.stopMs * 0.8 },
        ],
        shake: 0,
        pace: 1.15,
      };
    }
    const travel = wide ? (rect.w * scale - view.w) / view.w : (rect.h * scale - view.h) / view.h;
    const panMs = Math.min(PAN.maxMs, PAN.baseMs + travel * PAN.perScreenMs) * speed;
    return {
      from: start,
      steps: [
        { to: end, ms: panMs, at: 0 },
        { to, ms: 700 * speed, at: panMs * 0.8 },
      ],
      shake,
      pace: 1.25,
    };
  }

  if (tension >= 0.55) {
    return { from: fit(1.2), steps: move(900), shake: 2 + 5 * tension, pace: 0.85 };
  }
  if (rect.w / rect.h >= 1.8 && tension < 0.45) {
    // Plano de ubicación: arranca en el tercio derecho y se abre a la viñeta entera.
    const part = { x: rect.x + rect.w * 0.45, y: rect.y, w: rect.w * 0.55, h: rect.h };
    return { from: Camera.fit(part, view, FIT_MARGIN), steps: move(1440), shake: 0, pace: 1.1 };
  }
  if (tension <= 0.25) {
    return { from: fit(0.93), steps: move(1080), shake: 0, pace: 1.15 };
  }
  return { from: fit(1.07), steps: move(900), shake: 0, pace: 1 };
}

/** Lo que el plano necesita saber de la viñeta. */
export type ShotFrame = {
  rect: Rect;
  tension?: number;
  beats: { reveal?: string; hold?: number }[];
  layers?: { id: string; rect: Rect }[];
};

/** Disparador de los tramos que esperan a que se termine de leer la viñeta. */
export const HOLD = "#hold";

/**
 * Un tramo del plano. Arranca a los `at` ms de empezar la viñeta, o cuando aparece el globo
 * `on` (o con `HOLD`, cuando ya apareció todo), más `after` ms.
 */
export type ShotStep = { to: Transform; ms: number; at?: number; on?: string; after?: number; shake?: number };

/** Un plano de la cámara experimental: dónde arranca y los tramos que recorre. */
export type DirectedShot = {
  from: Transform;
  steps: ShotStep[];
  shake: number;
  /** Ritmo de lectura de la viñeta: más de 1, más lento. */
  pace: number;
};

/**
 * El paneo de las viñetas que enteras quedan chicas: desde cuánto se achican para que valga
 * la pena (`minGain`: entera ocuparía menos de un tercio de lo que podría), cuánto puede
 * acercarse como mucho, cuánto dura según lo que recorre y cuánto tarda en llegar a cada globo.
 */
const PAN = { minGain: 3, maxZoom: 2.4, baseMs: 900, perScreenMs: 1100, maxMs: 4200, stopMs: 1300 };

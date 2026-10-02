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

  const fitScale = Math.min(view.w / rect.w, view.h / rect.h);
  const coverScale = Math.max(view.w / rect.w, view.h / rect.h);
  const pad = 0.03 * Math.min(view.w, view.h);
  const shake = tension >= 0.55 ? 2 + 4 * tension : 0;

  // Paneo continuo de `start` a `end`, a velocidad pareja pero sin pasar un globo que todavía
  // no apareció. Dura lo que tarda en aparecer el diálogo, o lo que recorre si no hay. Al
  // terminar, se muestra la viñeta entera.
  const panShot = (start: Transform, end: Transform): DirectedShot => {
    const scale = start.scale;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len2 = dx * dx + dy * dy || 1;
    const along = (t: Transform) => ((t.x - start.x) * dx + (t.y - start.y) * dy) / len2;
    // Centrar un globo sin salirse del recorrido.
    const clamp = (v: number, a: number, b: number) => Math.min(Math.max(a, b), Math.max(Math.min(a, b), v));
    const aim = (r: Rect): Transform => ({
      scale,
      x: clamp(view.w / 2 - (r.x + r.w / 2) * scale, start.x, end.x),
      y: clamp(view.h / 2 - (r.y + r.h / 2) * scale, start.y, end.y),
    });
    const layers = new Map((frame.layers ?? []).map((l) => [l.id, l.rect]));
    const stops = frame.beats
      .filter((b) => b.reveal && layers.has(b.reveal))
      .map((b) => ({ id: b.reveal!, at: Math.min(1, Math.max(0, along(aim(layers.get(b.reveal!)!)))) }));
    // Lo que se recorre, en pantallas: de eso sale cuánto dura.
    const travel = Math.hypot(dx / view.w, dy / view.h);
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
  };

  // Si mostrarla entera la deja chica —una viñeta muy ancha o muy alta en una pantalla de la
  // otra forma, como un celular parado—, se recorre de cerca. Las anchas, de derecha a
  // izquierda, como se lee; las altas, de arriba a abajo.
  if (coverScale / fitScale >= PAN.minGain) {
    const scale = Math.min(coverScale * FIT_MARGIN, fitScale * PAN.maxZoom);
    const wide = rect.w * scale > view.w;
    const cx = view.w / 2 - (rect.x + rect.w / 2) * scale;
    const cy = view.h / 2 - (rect.y + rect.h / 2) * scale;
    return wide
      ? panShot(
          { scale, x: view.w - pad - (rect.x + rect.w) * scale, y: cy },
          { scale, x: pad - rect.x * scale, y: cy },
        )
      : panShot({ scale, x: cx, y: pad - rect.y * scale }, { scale, x: cx, y: view.h - pad - (rect.y + rect.h) * scale });
  }

  // Una viñeta grande, más o menos cuadrada, que entera se ve a menos de la mitad de su
  // resolución: el dibujo no se aprecia. Se recorre en diagonal desde la esquina de arriba a
  // la derecha, donde se empieza a leer, hasta la de abajo a la izquierda.
  if (fitScale < TOUR.maxScale) {
    const scale = fitScale * Math.min(TOUR.maxZoom, Math.max(TOUR.minZoom, TOUR.target / fitScale));
    // En el eje en que la viñeta ya entra, se la centra y no se mueve.
    const cx = view.w / 2 - (rect.x + rect.w / 2) * scale;
    const cy = view.h / 2 - (rect.y + rect.h / 2) * scale;
    const overW = rect.w * scale > view.w - 2 * pad;
    const overH = rect.h * scale > view.h - 2 * pad;
    return panShot(
      { scale, x: overW ? view.w - pad - (rect.x + rect.w) * scale : cx, y: overH ? pad - rect.y * scale : cy },
      { scale, x: overW ? pad - rect.x * scale : cx, y: overH ? view.h - pad - (rect.y + rect.h) * scale : cy },
    );
  }

  // En pantallas grandes casi ninguna viñeta queda chica, pero el recorrido gusta igual: se
  // acerca un poco y recorre lo que no entra, en el sentido de lectura.
  if (view.w >= GENTLE.minWidth) {
    const scale = fitScale * GENTLE.zoom;
    const overW = rect.w * scale > view.w - 2 * pad;
    const overH = rect.h * scale > view.h - 2 * pad;
    if (overW || overH) {
      const cx = view.w / 2 - (rect.x + rect.w / 2) * scale;
      const cy = view.h / 2 - (rect.y + rect.h / 2) * scale;
      return panShot(
        { scale, x: overW ? view.w - pad - (rect.x + rect.w) * scale : cx, y: overH ? pad - rect.y * scale : cy },
        { scale, x: overW ? pad - rect.x * scale : cx, y: overH ? view.h - pad - (rect.y + rect.h) * scale : cy },
      );
    }
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
 * la pena (`minGain`: entera ocuparía menos de la mitad de lo que podría, más o menos), cuánto puede
 * acercarse como mucho y cuánto dura según lo que recorre.
 */
/**
 * El recorrido en diagonal de las viñetas grandes: se hace si entera se vería a menos de
 * `maxScale` de su resolución, y se acerca hasta `target` sin pasar de entre `minZoom` y
 * `maxZoom` veces la viñeta entera.
 */
const TOUR = { maxScale: 0.55, target: 0.75, minZoom: 1.25, maxZoom: 1.6 };

/** El paneo suave de las pantallas grandes: desde qué ancho y cuánto se acerca. */
const GENTLE = { minWidth: 900, zoom: 1.3 };

const PAN = { minGain: 2.6, maxZoom: 1.6, baseMs: 2000, perScreenMs: 1700, maxMs: 7000 };

/**
 * Diagnóstico de rendimiento en el aparato de quien lee (`?perf=on`).
 *
 * En la compu el lector anda liso y en algunos celulares va a tirones, y lo que pasa en el
 * celular no se reproduce acá: la placa de video es otra, la memoria es poca, se calienta.
 * Esto mide ahí mismo cada cuadro y, en cada tirón, anota qué venía pasando —cambio de
 * viñeta, de página, un efecto, la IA procesando— para armar un informe que se puede copiar.
 *
 * Apagado no hace nada: las marcas salen en el acto.
 */

type Mark = { t: number; tag: string; ms?: number };
type Jank = { t: number; gap: number; ai: string | null; heap: number | null };

/** Desde cuántos milisegundos un cuadro cuenta como tirón (a 60 cuadros, tres perdidos). */
const JANK_MS = 50;
/** Qué tanto antes del tirón se miran las marcas. */
const LOOKBACK_MS = 400;
/** Cuántos tirones se guardan con detalle, y cuántas marcas para explicarlos. */
const KEEP = 120;
const KEEP_MARKS = 4000;

const on =
  typeof window !== "undefined" &&
  (() => {
    try {
      const v = new URLSearchParams(window.location.search).get("perf");
      if (v === "on") sessionStorage.setItem("mangaji:perf", "1");
      if (v === "off") sessionStorage.removeItem("mangaji:perf");
      return sessionStorage.getItem("mangaji:perf") === "1";
    } catch {
      return false;
    }
  })();

const marks: Mark[] = [];
const janks: Jank[] = [];
/** Por cada ventana de diez segundos: cuadros, tirones y cuánto estuvo procesando la IA. */
const windows: { t: number; frames: number; janks: number; worst: number; aiMs: number }[] = [];
let ai: { stage: string; since: number } | null = null;
let aiTotal = 0;
let frames = 0;
let started = 0;
const info: Record<string, unknown> = {};
const listeners = new Set<() => void>();

function heap(): number | null {
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return m ? Math.round(m.usedJSHeapSize / 1e6) : null;
}

function windowAt(t: number) {
  const start = Math.floor((t - started) / 10_000) * 10_000;
  let w = windows[windows.length - 1];
  if (!w || w.t !== start) {
    w = { t: start, frames: 0, janks: 0, worst: 0, aiMs: 0 };
    windows.push(w);
  }
  return w;
}

function push(m: Mark): void {
  marks.push(m);
  if (marks.length > KEEP_MARKS) marks.shift();
}

function loop(): void {
  let last = performance.now();
  const tick = (now: number) => {
    const gap = now - last;
    last = now;
    frames++;
    const w = windowAt(now);
    w.frames++;
    w.worst = Math.max(w.worst, Math.round(gap));
    if (ai) w.aiMs += gap;
    // Con la pestaña en segundo plano no hay cuadros: eso no es un tirón.
    if (gap >= JANK_MS && gap < 5000 && document.visibilityState === "visible") {
      w.janks++;
      // Lo que lo explica se junta recién al armar el informe: las tareas largas las avisa
      // el navegador un rato después.
      janks.push({ t: now, gap, ai: ai?.stage ?? null, heap: heap() });
      if (janks.length > KEEP) janks.shift();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) push({ t: e.startTime, tag: "tarea larga", ms: e.duration });
    }).observe({ type: "longtask" });
  } catch {
    // No todos los navegadores lo tienen.
  }
}

if (on) {
  started = performance.now();
  info.userAgent = navigator.userAgent;
  info.cores = navigator.hardwareConcurrency;
  info.memoryGB = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? null;
  info.pixelRatio = window.devicePixelRatio;
  info.screen = `${screen.width}x${screen.height}`;
  info.webgpu = "gpu" in navigator;
  loop();
  // El resumen en vivo, dos veces por segundo.
  window.setInterval(() => listeners.forEach((fn) => fn()), 500);
}

export const perf = {
  on,

  /** Algo que pasó, con lo que tardó si se midió. */
  mark(tag: string, ms?: number): void {
    if (!on) return;
    push({ t: performance.now(), tag, ms });
  },

  /** Mide lo que tarda `fn` y lo marca. */
  time<T>(tag: string, fn: () => T): T {
    if (!on) return fn();
    const t0 = performance.now();
    try {
      return fn();
    } finally {
      perf.mark(tag, performance.now() - t0);
    }
  },

  /** En qué anda la IA: una etapa mientras procesa, `null` al terminar la página. */
  ai(stage: string | null): void {
    if (!on) return;
    const now = performance.now();
    if (ai) aiTotal += now - ai.since;
    ai = stage ? { stage, since: now } : null;
    push({ t: now, tag: stage ? `ia:${stage}` : "ia:lista" });
  },

  /** Datos del aparato que se conocen recién más tarde (la placa, el backend de la IA). */
  info(key: string, value: unknown): void {
    if (on) info[key] = value;
  },

  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  live() {
    const now = performance.now();
    const recent = windows.slice(-1)[0];
    return {
      seconds: Math.round((now - started) / 1000),
      fps: recent ? Math.round((recent.frames * 1000) / Math.max(1, now - started - recent.t)) : 0,
      janks: janks.length,
      ai: ai?.stage ?? null,
      heap: heap(),
    };
  },

  /** Empieza de cero: al abrir el lector, para no mezclar la carga con la lectura. */
  reset(): void {
    if (!on) return;
    started = performance.now();
    frames = 0;
    aiTotal = 0;
    janks.length = 0;
    windows.length = 0;
  },

  report(): string {
    const explained = janks.map((j) => {
      const from = j.t - j.gap - LOOKBACK_MS;
      const tags = marks
        .filter((m) => m.t >= from && m.t <= j.t)
        .map((m) => (m.ms ? `${m.tag} ${Math.round(m.ms)}ms` : m.tag));
      return { t: Math.round(j.t - started), gap: Math.round(j.gap), ai: j.ai, heap: j.heap, tags };
    });
    return JSON.stringify(
      {
        info,
        seconds: Math.round((performance.now() - started) / 1000),
        frames,
        aiSeconds: Math.round((aiTotal + (ai ? performance.now() - ai.since : 0)) / 1000),
        windows: windows.map((w) => ({ ...w, aiMs: Math.round(w.aiMs) })),
        janks: explained,
      },
      null,
      1,
    );
  },
};


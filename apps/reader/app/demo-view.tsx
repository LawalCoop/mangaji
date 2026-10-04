"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Manifest } from "@mangaji/format";
import type { ArchiveSource } from "../lib/archive";
import type { PanelFrameSource } from "../lib/frame-sources";
import { useI18n } from "../lib/i18n";
import { CPU_2D } from "../lib/canvas";

/**
 * Modo demo (`?demo=on`): para dejar de fondo en una charla o en un stand.
 *
 * Con cada página real del tomo muestra, animado, lo que hace Mangaji: escanea, encuentra
 * las viñetas y los textos, levanta el diálogo y lo guarda en una cola, y después dirige la
 * cámara viñeta por viñeta sacando los globos de la cola, anunciando los efectos y los
 * paneos. Los datos son los del procesamiento de verdad; lo que se simula es el ritmo, para
 * que se pueda seguir con la vista.
 */

type Page = Manifest["pages"][number];
type Panel = Page["panels"][number];

const CYAN = "#00D9F5";
const MAGENTA = "#FF2E88";
const PAPER = "#F4EFE3";

/** Tiempos de cada fase, en ms. */
const T = {
  scan: 2600,
  panelEach: 380,
  panelsHold: 900,
  textEach: 120,
  textsHold: 900,
  liftEach: 140,
  liftHold: 900,
  enter: 900,
  balloon: 1100,
  panelHold: 900,
  pan: 3200,
  outro: 1400,
};

/**
 * Por debajo, la "viñeta" la armó el pipeline para no dejar la página sin encuadre (un dibujo
 * a sangre, una tapa): la confianza del modelo no dice nada y se muestra como página entera.
 */
const LOW_CONF = 0.4;

/** Un panel se recorre con paneo si encuadrarlo entero le haría perder mucho detalle. */
const PAN_RATIO = 1.7;
/** Cuánto más cerca que la viñeta entera se recorre, como mucho. */
const PAN_MAX_ZOOM = 1.8;

type Phase = "scan" | "panels" | "texts" | "lift" | "direct" | "done" | "waiting";

type Tag = { key: number; text: string; tone: "cyan" | "magenta" };

type Camera = { x: number; y: number; scale: number; ms: number };

/** Los globos de una página, una vez cada uno (uno a caballo de dos viñetas figura en las dos). */
function balloonsOf(page: Page) {
  return [...new Map(page.panels.flatMap((p) => p.balloons).filter((b) => b.sprite).map((b) => [b.id, b])).values()];
}

/** Qué efecto trae la viñeta, si trae. */
function effectOf(panel: Panel): { kind: "shake" | "flash" | "speedlines"; } | null {
  for (const beat of panel.beats) {
    const fx = beat.fx?.kind;
    if (fx === "shake" || fx === "flash" || fx === "speedlines") return { kind: fx };
  }
  return null;
}

export function DemoView({
  source,
  frames,
  title,
  onExit,
}: {
  source: ArchiveSource;
  frames: PanelFrameSource;
  title: string;
  onExit: () => void;
}) {
  const { t } = useI18n();
  const D = t.demo;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  const [page, setPage] = useState<Page | null>(null);
  const [art, setArt] = useState<string | null>(null);
  const [sprites, setSprites] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<Phase>("waiting");
  const [panelsShown, setPanelsShown] = useState(0);
  const [textsShown, setTextsShown] = useState(0);
  /** Globos fuera de la página: en la cola. */
  const [queued, setQueued] = useState<string[]>([]);
  /** Globos de vuelta en su lugar. */
  const [placed, setPlaced] = useState<Set<string>>(new Set());
  const [lifted, setLifted] = useState(false);
  const [current, setCurrent] = useState<number | null>(null);
  const [camera, setCamera] = useState<Camera | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [effect, setEffect] = useState<"shake" | "flash" | "speedlines" | null>(null);
  const [view, setView] = useState({ w: 1, h: 1 });

  const stageRef = useRef<HTMLDivElement>(null);
  const queueRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const tagKey = useRef(0);

  // El área donde se muestra la página.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setView({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const say = useCallback((text: string, tone: Tag["tone"] = "cyan") => {
    const key = ++tagKey.current;
    setTags((list) => [...list.slice(-3), { key, text, tone }]);
  }, []);

  /** Lleva la cámara a un rectángulo de la página. */
  const frameRect = useCallback(
    (r: { x: number; y: number; w: number; h: number }, ms: number, fill = 0.88) => {
      const scale = Math.min((view.w * fill) / r.w, (view.h * fill) / r.h);
      setCamera({
        scale,
        x: view.w / 2 - (r.x + r.w / 2) * scale,
        y: view.h / 2 - (r.y + r.h / 2) * scale,
        ms,
      });
    },
    [view],
  );

  // El guion de una página. Se corta si se pasa a otra.
  useEffect(() => {
    let cancelled = false;
    const sleep = async (ms: number) => {
      let left = ms;
      while (left > 0) {
        if (cancelled) throw new Error("cancelado");
        const step = Math.min(left, 50);
        await new Promise((r) => setTimeout(r, step));
        if (!pausedRef.current) left -= step;
      }
      if (cancelled) throw new Error("cancelado");
    };

    const run = async () => {
      setPhase("waiting");
      setPage(null);
      setArt(null);
      setSprites({});
      setPanelsShown(0);
      setTextsShown(0);
      setQueued([]);
      setPlaced(new Set());
      setLifted(false);
      setCurrent(null);
      setTags([]);
      setEffect(null);

      // La página tiene que estar procesada.
      let data = frames.pageData(index);
      while (!data) {
        await sleep(300);
        data = frames.pageData(index);
      }
      const [w, h] = data.size;

      // El arte (sin texto) y los globos, como imágenes.
      const bitmap = await source.bitmap(index);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d", CPU_2D)!.drawImage(bitmap, 0, 0, w, h);
      const artUrl = canvas.toDataURL("image/jpeg", 0.88);
      const list = balloonsOf(data);
      const urls: Record<string, string> = {};
      for (const b of list) {
        try {
          const bm = await source.bitmapOf(b.sprite);
          const c = document.createElement("canvas");
          c.width = bm.width;
          c.height = bm.height;
          c.getContext("2d", CPU_2D)!.drawImage(bm, 0, 0);
          urls[b.id] = c.toDataURL("image/png");
        } catch {
          // Sin el globo, la demo sigue con los demás.
        }
      }
      if (cancelled) return;
      setPage(data);
      setArt(artUrl);
      setSprites(urls);
      // Toda la página a la vista, con su diálogo: así la vio la IA.
      setPlaced(new Set(Object.keys(urls)));
      frameRect({ x: 0, y: 0, w, h }, 0, 0.94);

      // 1. Escaneo.
      setPhase("scan");
      say(D.tagScan(w, h));
      await sleep(T.scan);

      // 2. Viñetas.
      setPhase("panels");
      for (let i = 1; i <= data.panels.length; i++) {
        setPanelsShown(i);
        const p = data.panels[i - 1];
        say(p.confidence >= LOW_CONF ? D.tagPanel(i, Math.round(p.confidence * 100)) : D.tagWhole);
        await sleep(T.panelEach);
      }
      await sleep(T.panelsHold);

      // 3. Textos.
      setPhase("texts");
      for (let i = 1; i <= list.length; i++) {
        setTextsShown(i);
        await sleep(T.textEach);
      }
      say(D.tagTexts(list.length), "magenta");
      await sleep(T.textsHold);

      // 4. Levantar el diálogo a la cola.
      setPhase("lift");
      setLifted(true);
      for (const b of list) {
        if (!urls[b.id]) continue;
        setPlaced((s) => {
          const n = new Set(s);
          n.delete(b.id);
          return n;
        });
        setQueued((q) => [...q, b.id]);
        await sleep(T.liftEach);
      }
      say(D.tagLifted(list.length), "magenta");
      await sleep(T.liftHold);

      // 5. Dirección de cámara.
      setPhase("direct");
      say(D.tagDirect);
      for (let i = 0; i < data.panels.length; i++) {
        const panel = data.panels[i];
        setCurrent(i);
        const [x, y, pw, ph] = panel.bbox;
        const tension = panel.look?.tension;
        const fx = effectOf(panel);
        // ¿Entra entera sin perder detalle, o se recorre?
        const fit = Math.min(view.w / pw, view.h / ph);
        const fillW = view.w / pw;
        const fillH = view.h / ph;
        const pan = Math.max(fillW, fillH) / fit > PAN_RATIO;

        if (pan) {
          // Del comienzo de la lectura al final: derecha a izquierda si es ancha, arriba abajo si es alta.
          const wide = pw / ph > view.w / view.h;
          // Acercándose, pero no tanto que se pierda de qué se trata la viñeta.
          const scale = Math.min(wide ? fillH * 0.92 : fillW * 0.92, fit * PAN_MAX_ZOOM);
          const start = wide
            ? { x: view.w - (x + pw) * scale, y: view.h / 2 - (y + ph / 2) * scale }
            : { x: view.w / 2 - (x + pw / 2) * scale, y: -y * scale + view.h * 0.04 };
          const end = wide
            ? { x: -x * scale, y: start.y }
            : { x: start.x, y: view.h - (y + ph) * scale - view.h * 0.04 };
          setCamera({ ...start, scale, ms: T.enter });
          say(D.tagPan(wide));
          await sleep(T.enter);
          setCamera({ ...end, scale, ms: T.pan });
        } else {
          frameRect({ x, y, w: pw, h: ph }, T.enter);
          await sleep(T.enter);
        }

        if (tension !== undefined) say(D.tagTension(Math.round(tension * 100)));
        if (fx) {
          say(D.tagEffect(fx.kind), "magenta");
          setEffect(fx.kind);
          await sleep(650);
          setEffect(null);
        }

        // Los globos de esta viñeta salen de la cola, en orden.
        for (const b of [...panel.balloons].sort((a, b2) => a.order - b2.order)) {
          if (!urls[b.id]) continue;
          setQueued((q) => q.filter((id) => id !== b.id));
          setPlaced((s) => new Set(s).add(b.id));
          await sleep(T.balloon);
        }
        await sleep(pan ? Math.max(T.panelHold, T.pan - panel.balloons.length * T.balloon) : T.panelHold);
      }

      // 6. Página lista.
      setCurrent(null);
      setPhase("done");
      frameRect({ x: 0, y: 0, w, h }, T.outro, 0.94);
      say(D.tagDone);
      await sleep(T.outro + 1200);
      if (index + 1 < frames.pageTotal) setIndex((i) => i + 1);
    };

    run().catch(() => {});
    return () => {
      cancelled = true;
    };
    // `view` cambia al redimensionar: rehacer la página entera es lo más simple.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, view.w, view.h]);

  // Teclado: flechas para pasar de página (manga: izquierda avanza), espacio pausa, Esc sale.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setIndex((i) => Math.min(i + 1, frames.pageTotal - 1));
      else if (e.key === "ArrowRight") setIndex((i) => Math.max(i - 1, 0));
      else if (e.key === " " || e.key === "p") {
        e.preventDefault();
        setPaused((p) => !p);
      } else if (e.key === "Escape") onExit();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [frames, onExit]);

  const steps: { id: Phase; label: string }[] = [
    { id: "scan", label: D.stepScan },
    { id: "panels", label: D.stepPanels },
    { id: "texts", label: D.stepTexts },
    { id: "lift", label: D.stepLift },
    { id: "direct", label: D.stepDirect },
  ];
  const order: Phase[] = ["waiting", "scan", "panels", "texts", "lift", "direct", "done"];
  const at = order.indexOf(phase);
  const w = page?.size[0] ?? 1;
  const h = page?.size[1] ?? 1;
  const balloons = page ? balloonsOf(page) : [];

  return (
    <div className="demo fixed inset-0 z-40 flex flex-col overflow-hidden bg-[#07070A] text-neutral-200">
      {/* Fondo: grilla técnica que late. */}
      <div aria-hidden className="demo-grid pointer-events-none absolute inset-0" />

      {/* Arriba: marca, tomo y el paso en curso. */}
      <header className="relative z-10 flex flex-wrap items-center gap-x-6 gap-y-2 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="trim-caps font-[family-name:var(--display)] text-[24px] leading-none text-white">MANGAJI</span>
          <span className="rounded-sm border px-1.5 py-0.5 font-mono text-[10px] tracking-[0.2em]" style={{ borderColor: CYAN, color: CYAN }}>
            DEMO
          </span>
        </div>
        <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-neutral-500">
          {title} · {D.page(index + 1, frames.pageTotal)}
        </p>
        <ol className="flex gap-1 font-mono text-[10px] sm:text-[11px]">
          {steps.map((s, i) => {
            const state = order.indexOf(s.id) < at ? "done" : s.id === phase ? "now" : "later";
            return (
              <li
                key={s.id}
                className="flex items-center gap-1.5 border px-2 py-1 uppercase tracking-wider transition-colors duration-300"
                style={{
                  borderColor: state === "now" ? CYAN : "#26262E",
                  color: state === "now" ? "#07070A" : state === "done" ? "#9A9AA6" : "#4A4A55",
                  background: state === "now" ? CYAN : "transparent",
                }}
              >
                <span>{String(i + 1).padStart(2, "0")}</span>
                <span className="max-sm:hidden">{s.label}</span>
              </li>
            );
          })}
        </ol>
      </header>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col gap-3 px-4 pb-3 sm:flex-row sm:px-6">
        {/* La página, con la cámara. */}
        <div
          ref={stageRef}
          className={`relative min-h-0 flex-1 overflow-hidden border border-[#1C1C24] ${effect === "shake" ? "demo-shake" : ""}`}
        >
          {page && art && camera && (
            <div
              ref={pageRef}
              className="absolute top-0 left-0 origin-top-left"
              style={{
                width: w,
                height: h,
                transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
                transition: `transform ${camera.ms}ms cubic-bezier(0.65, 0, 0.35, 1)`,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={art} alt="" className="absolute inset-0 size-full select-none" draggable={false} />
              {balloons.map((b) =>
                sprites[b.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={b.id}
                    src={sprites[b.id]}
                    alt=""
                    draggable={false}
                    className="absolute select-none transition-all duration-500"
                    style={{
                      left: b.bbox[0],
                      top: b.bbox[1],
                      width: b.bbox[2],
                      height: b.bbox[3],
                      opacity: placed.has(b.id) ? 1 : 0,
                      transform: placed.has(b.id) ? "scale(1)" : lifted ? "translate(40%, -30%) scale(0.6)" : "scale(1)",
                      filter: placed.has(b.id) && !lifted ? "none" : "drop-shadow(0 0 12px rgba(255,46,136,0.6))",
                    }}
                  />
                ) : null,
              )}

              {/* Lo que la IA encontró, dibujado encima. */}
              <svg viewBox={`0 0 ${w} ${h}`} className="pointer-events-none absolute inset-0 size-full">
                {page.panels.slice(0, panelsShown).map((p, i) => {
                  const active = current === i;
                  const dim = current !== null && !active;
                  return (
                    <g key={p.id} style={{ opacity: dim ? 0.25 : 1, transition: "opacity 400ms" }}>
                      <polygon
                        points={p.polygon.map((pt) => pt.join(",")).join(" ")}
                        fill={active ? "rgb(0 217 245 / 0.06)" : "rgb(0 217 245 / 0.10)"}
                        stroke={CYAN}
                        strokeWidth={Math.max(w, h) / 260}
                        pathLength={1}
                        className="demo-draw"
                      />
                    </g>
                  );
                })}
                {phase !== "direct" &&
                  phase !== "done" &&
                  balloons.slice(0, textsShown).map((b) => (
                    <rect
                      key={b.id}
                      x={b.bbox[0]}
                      y={b.bbox[1]}
                      width={b.bbox[2]}
                      height={b.bbox[3]}
                      fill="rgb(255 46 136 / 0.15)"
                      stroke={MAGENTA}
                      strokeWidth={Math.max(w, h) / 360}
                      className="demo-pop"
                      style={{ transformOrigin: `${b.bbox[0] + b.bbox[2] / 2}px ${b.bbox[1] + b.bbox[3] / 2}px` }}
                    />
                  ))}
              </svg>
              {/* Etiquetas de cada viñeta, fuera del SVG para que no se deformen. */}
              {phase !== "direct" && page.panels.slice(0, panelsShown).map((p, i) => (
                <span
                  key={`l${p.id}`}
                  className="demo-pop absolute flex items-center gap-1 font-mono font-bold whitespace-nowrap"
                  style={{
                    left: p.bbox[0] + p.bbox[2] * 0.03,
                    top: p.bbox[1] + p.bbox[3] * 0.03,
                    fontSize: Math.max(w, h) / 42,
                    padding: `${Math.max(w, h) / 300}px ${Math.max(w, h) / 160}px`,
                    background: CYAN,
                    color: "#07070A",
                    opacity: current !== null && current !== i ? 0.3 : 1,
                  }}
                >
                  {i + 1} · {p.confidence >= LOW_CONF ? `${Math.round(p.confidence * 100)}%` : D.whole}
                </span>
              ))}
            </div>
          )}

          {/* Escaneo: una línea que recorre la página. */}
          {phase === "scan" && <div aria-hidden className="demo-scan pointer-events-none absolute inset-x-0 h-24" />}
          {effect === "flash" && <div aria-hidden className="demo-flash pointer-events-none absolute inset-0 bg-white" />}
          {effect === "speedlines" && <div aria-hidden className="demo-lines pointer-events-none absolute inset-0" />}

          {phase === "waiting" && (
            <div className="absolute inset-0 flex items-center justify-center font-mono text-[12px] tracking-widest text-neutral-500">
              <span className="mr-2 inline-block size-2 animate-pulse" style={{ background: CYAN }} />
              {D.waiting}
            </div>
          )}

          {/* El registro: lo último que pasó, como una consola. */}
          <div className="pointer-events-none absolute bottom-3 left-3 flex max-w-[min(26rem,80%)] flex-col gap-1.5">
            {tags.map((tag) => (
              <span
                key={tag.key}
                className="demo-tag w-fit border-l-2 bg-black/75 px-2.5 py-1 font-mono text-[11px] text-neutral-100 backdrop-blur sm:text-[12px]"
                style={{ borderColor: tag.tone === "cyan" ? CYAN : MAGENTA }}
              >
                {tag.text}
              </span>
            ))}
          </div>
        </div>

        {/* La cola de diálogos levantados. */}
        <aside className="flex shrink-0 flex-col border border-[#1C1C24] bg-black/40 sm:w-44">
          <p className="border-b border-[#1C1C24] px-3 py-2 font-mono text-[10px] tracking-[0.2em] text-neutral-500 uppercase">
            {D.queue} <span style={{ color: MAGENTA }}>· {queued.length}</span>
          </p>
          <div ref={queueRef} className="flex min-h-[4.5rem] flex-1 gap-2 overflow-hidden p-2 sm:flex-col">
            {queued.map((id) => (
              <div key={id} className="demo-in shrink-0 border p-1" style={{ borderColor: "#2A2A33", background: PAPER }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sprites[id]} alt="" className="max-h-14 w-auto max-w-[6rem] sm:max-h-16 sm:max-w-full" />
              </div>
            ))}
          </div>
        </aside>
      </div>

      {/* Controles mínimos. */}
      <footer className="relative z-10 flex items-center justify-center gap-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] font-mono text-[11px]">
        <button type="button" onClick={() => setIndex((i) => Math.max(i - 1, 0))} className="border border-[#26262E] px-3 py-1.5 hover:border-neutral-500">
          ‹ {D.prev}
        </button>
        <button type="button" onClick={() => setPaused((p) => !p)} className="border px-4 py-1.5" style={{ borderColor: CYAN, color: CYAN }}>
          {paused ? `▶ ${D.resume}` : `❚❚ ${D.pause}`}
        </button>
        <button
          type="button"
          onClick={() => setIndex((i) => Math.min(i + 1, frames.pageTotal - 1))}
          className="border border-[#26262E] px-3 py-1.5 hover:border-neutral-500"
        >
          {D.next} ›
        </button>
        <button type="button" onClick={onExit} className="ml-3 border border-[#26262E] px-3 py-1.5 text-neutral-500 hover:text-neutral-200">
          ✕
        </button>
      </footer>
    </div>
  );
}

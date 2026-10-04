"use client";

import { useEffect, useRef, useState } from "react";
import { etaText, noteText, useI18n, type Messages } from "../lib/i18n";
import type { Note } from "../lib/notes";
import { TONE } from "./site";
import { DetectScene, LiftScene, PrepareScene } from "./como-funciona/scenes";

/**
 * Pantalla de procesamiento.
 *
 * Solo se ve hasta que la primera página está lista —unos segundos—: de ahí en adelante la
 * lectura empieza y el resto del tomo se procesa detrás. Aun así cuenta qué está pasando en
 * vez de mostrar una barra muda, porque es el rato en que se cargan los modelos.
 */

export type Stage =
  | { kind: "opening" }
  | { kind: "models"; note: Note }
  | { kind: "page"; index: number; total: number; note: Note };

/** La página que se está procesando, en chico: ahí se dibuja lo que la IA encuentra. */
export type Preview = { index: number; src: string; aspect: number };

/** Una línea del registro; `page` si pasó procesando una página en particular. */
export type LogLine = { note: Note; page?: number };

const INK = "#0B0B0C";
const PAPER = "#F4EFE3";
const CYAN = "#00D9F5";
const MAGENTA = "#FF2E88";

export type ProcessingProps = {
  title: string;
  stage: Stage | null;
  lines: LogLine[];
  /** 0..1 de todo lo que falta para empezar a leer, detectores incluidos; null sin datos. */
  progress: number | null;
  /** Segundos que faltan, o null mientras no hay con qué estimarlo. */
  eta: number | null;
  preview?: Preview | null;
};

export function Processing({ title, stage, lines, progress, eta, preview }: ProcessingProps) {
  const [tick, setTick] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  const P = t.processing;

  // Late para que la espera no se sienta congelada cuando una página tarda.
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 420);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [lines.length]);

  const pct = progress === null ? null : Math.round(progress * 100);

  return (
    <div className="relative flex min-h-dvh w-full flex-col overflow-hidden bg-[#121214] px-4 py-6 sm:px-8">
      {/* Líneas de velocidad girando: la página está en movimiento.
          Gira un cuadrado mucho más grande que la pantalla, no la pantalla misma: un
          rectángulo del tamaño del viewport deja asomar sus esquinas al rotar. 160vmax
          cubre la distancia del centro a la esquina más lejana en cualquier proporción. */}
      <div
        aria-hidden
        className="pointer-events-none absolute opacity-40"
        style={{
          left: "50%",
          top: "45%",
          width: "160vmax",
          height: "160vmax",
          background:
            "repeating-conic-gradient(from 0deg, #ffffff 0deg 0.4deg, transparent 0.4deg 2.1deg)",
          maskImage: "radial-gradient(circle, transparent 15vmax, black 45vmax)",
          WebkitMaskImage: "radial-gradient(circle, transparent 15vmax, black 45vmax)",
          transform: `translate(-50%, -50%) rotate(${tick * 1.6}deg)`,
          transition: "transform 420ms linear",
        }}
      />

      {/* Arriba y no centrada: el alto del contenido cambia mientras carga, y centrada la
          tarjeta subía y bajaba con cada cambio. */}
      <div className="relative mx-auto flex w-full max-w-4xl flex-1 flex-col justify-start gap-5 pt-[10vh]">
        {/* Guiño: el rumor amenazante, asomando por el costado de la tarjeta. */}
        <span
          aria-hidden
          className="pointer-events-none absolute top-[14%] -left-40 z-10 flex select-none flex-col font-[family-name:var(--font-kana)] font-black leading-[0.85] max-xl:hidden"
          style={{ fontSize: "clamp(3rem, 6vw, 5.2rem)", color: "#121214", WebkitTextStroke: `3px ${MAGENTA}`, transform: "rotate(-10deg)" }}
        >
          {["ド", "ド", "ド", "ド"].map((g, i) => (
            <span key={i} className="rumble" style={{ marginLeft: `${i * 0.28}em`, animationDelay: `${i * 90}ms` }}>
              {g}
            </span>
          ))}
        </span>

        {/* Las tarjetas, apenas inclinadas en sentidos opuestos: viñetas pegadas en una página. */}
        <section
          className="relative isolate overflow-hidden border-[4px] px-6 py-7 sm:-rotate-[0.8deg] sm:px-10 sm:py-10"
          style={{ borderColor: INK, background: PAPER }}
        >
          {/* Guiño: la trama de puntos del manga impreso, desde la esquina. */}
          <span
            aria-hidden
            className="pointer-events-none absolute top-0 right-0 -z-10 h-full w-1/2"
            style={{
              background: TONE,
              maskImage: "linear-gradient(225deg, black 0%, transparent 60%)",
              WebkitMaskImage: "linear-gradient(225deg, black 0%, transparent 60%)",
            }}
          />
          {/* Guiño: "en preparación", en vertical como un encabezado de capítulo. */}
          <span
            aria-hidden
            className="absolute top-0 right-6 px-2 py-3 font-[family-name:var(--font-kana)] text-[14px] font-black tracking-[0.3em] sm:right-10"
            style={{ writingMode: "vertical-rl", background: INK, color: PAPER }}
          >
            準備中
          </span>
          <p
            className="relative mb-3 font-[family-name:var(--display)] text-[13px] tracking-wide"
            style={{ color: "#3A3A42" }}
          >
            {P.label} · {title}
          </p>

          <h1
            className="relative whitespace-nowrap font-[family-name:var(--display)] uppercase leading-[0.9]"
            style={{
              // En un renglón siempre: "Leyendo la página" en dos agrandaba la tarjeta.
              fontSize: "clamp(1.9rem,6.5vw,5rem)",
              color: INK,
              textShadow: `0.04em 0 0 ${CYAN}, -0.04em 0 0 ${MAGENTA}`,
            }}
          >
            {headline(t, stage)}
          </h1>

          <p className="relative mt-4 truncate text-[16px] font-medium sm:text-[19px]" style={{ color: "#24242A" }}>
            {detail(t, stage)}
            <span aria-hidden>{".".repeat(1 + (tick % 3))}</span>
          </p>

          {/* La barra: segmentada, como una tira de viñetas que se va llenando. */}
          <div className="mt-7 flex items-center gap-4">
            <div className="flex h-6 flex-1 gap-[3px]">
              {Array.from({ length: 28 }, (_, i) => {
                const filled = pct !== null && (i + 1) / 28 <= progress!;
                // Un solo tramo en curso: el que contiene el punto de avance.
                const edge = pct !== null && i === Math.min(27, Math.floor(progress! * 28));
                // El tramo en curso titila, como un cursor: quieto se leía como un color
                // puesto porque sí, no como "acá se está trabajando".
                return (
                  <span
                    key={i}
                    className={`flex-1 ${!filled && edge ? "segment-live" : ""}`}
                    style={{
                      border: `2px solid ${INK}`,
                      background: filled ? INK : edge ? CYAN : "transparent",
                    }}
                  />
                );
              })}
            </div>
            <span
              className="relative w-16 text-right font-[family-name:var(--display)] text-2xl tabular-nums"
              style={{ color: INK }}
            >
              {pct === null ? "··" : `${pct}%`}
              {/* Guiño: destellos junto al porcentaje, que titilan mientras se trabaja. */}
              <span aria-hidden className="kira-idle absolute -top-3 -right-3 text-[14px] leading-none" style={{ color: MAGENTA }}>
                ✦
              </span>
              <span aria-hidden className="kira-idle absolute -bottom-2 -left-1 text-[10px] leading-none" style={{ color: CYAN, animationDelay: "450ms" }}>
                ✦
              </span>
            </span>
          </div>

          {/* Los avisos tienen su lugar reservado: aparecen y se van mientras carga, y sin
              esto la tarjeta cambiaba de alto. */}
          <div className="relative min-h-[5rem] sm:min-h-[3.5rem]">
            {eta !== null && (
              <p className="mt-2 text-[13px] font-medium" style={{ color: "#5A5A62" }}>
                {P.remaining(etaText(t, eta))}
              </p>
            )}

            {/* Desde el celular pesa: mejor saberlo antes que descubrirlo en la factura. */}
            {stage?.kind === "models" && (
              <p className="mt-3 text-[13px] font-medium leading-snug" style={{ color: "#5A5A62" }}>
                {P.firstTime}
              </p>
            )}
          </div>
        </section>

        <Live stage={stage} preview={preview ?? null} />

        {/* El registro: qué fue encontrando, línea por línea. */}
        <section
          ref={logRef}
          className="h-32 overflow-y-auto border-[4px] px-5 py-4 sm:h-40 sm:rotate-[0.5deg]"
          style={{ borderColor: INK, background: "#0F0F12" }}
        >
          <pre className="whitespace-pre-wrap text-[12px] leading-relaxed sm:text-[13px]">
            {lines.map((line, i) => (
              <span key={i} className="block" style={{ color: i === lines.length - 1 ? PAPER : "#6E6E78" }}>
                <span style={{ color: i === lines.length - 1 ? CYAN : "#3A3A42" }}>›</span>{" "}
                {line.page === undefined
                  ? noteText(t, line.note)
                  : P.logPage(line.page, noteText(t, line.note))}
              </span>
            ))}
          </pre>
        </section>

        <p className="text-center text-[12px] font-medium" style={{ color: "#5A5A62" }}>
          {P.footer}
        </p>
      </div>
    </div>
  );
}

function headline(t: Messages, stage: Stage | null): string {
  switch (stage?.kind) {
    case "models":
      return t.processing.headlineModels;
    case "page":
      return t.processing.headlinePage;
    default:
      return t.processing.headlineOpening;
  }
}

function detail(t: Messages, stage: Stage | null): string {
  switch (stage?.kind) {
    case "models":
      return noteText(t, stage.note);
    case "page":
      return `${t.processing.pageOf(stage.index + 1, stage.total)} · ${noteText(t, stage.note)}`;
    default:
      return t.processing.unpacking;
  }
}

/** En qué paso está: 0 los modelos, 1 buscando viñetas, 2 el diálogo. */
function stepOf(stage: Stage | null): number {
  if (!stage || stage.kind !== "page") return 0;
  return stage.note.key === "liftingDialogue" ? 2 : 1;
}

/**
 * Lo que está haciendo la IA, mientras se espera: la página que se procesa, con lo que va
 * encontrando dibujado encima en el momento —las viñetas numeradas en orden de lectura, los
 * textos—, y al lado los pasos, con el actual resaltado y su animación.
 */
function Live({ stage, preview }: { stage: Stage | null; preview: Preview | null }) {
  const { t } = useI18n();
  const L = t.processing.live;
  const H = t.how;
  const step = stepOf(stage);
  const note = stage?.kind === "page" && preview && stage.index === preview.index ? stage.note : null;
  const shapes = note?.key === "liftingDialogue" ? note.shapes : undefined;
  const scanning = stage?.kind === "page" && !shapes;
  const scenes = [
    <PrepareScene key="p" label={H.steps[1].title} />,
    <DetectScene key="d" label={H.steps[2].title} t={H.scene} />,
    <LiftScene key="l" label={H.steps[5].title} t={H.scene} />,
  ];

  return (
    <section
      className="grid gap-5 border-[4px] p-4 sm:grid-cols-[minmax(0,15rem)_1fr] sm:p-6"
      style={{ borderColor: INK, background: "#17171B" }}
      aria-live="polite"
    >
      {/* La página, con lo que va encontrando. */}
      <div className="mx-auto w-full max-w-[15rem]">
        <div
          className="relative overflow-hidden border-[3px]"
          style={{ borderColor: INK, aspectRatio: preview ? `${preview.aspect}` : "0.7", background: PAPER }}
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview.src} alt="" className="absolute inset-0 size-full object-cover" />
          ) : (
            <div className="absolute inset-0" style={{ background: TONE, opacity: 0.5 }} />
          )}
          {scanning && <span aria-hidden className="live-scan absolute inset-x-0 h-10" />}
          {shapes && (
            <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden>
              {shapes.panels.map((poly, i) => (
                <polygon
                  key={`p${i}`}
                  points={poly.map((pt) => pt.join(",")).join(" ")}
                  fill="rgb(0 217 245 / 0.10)"
                  stroke={CYAN}
                  strokeWidth={3}
                  vectorEffect="non-scaling-stroke"
                  pathLength={1}
                  className="live-draw"
                  style={{ animationDelay: `${i * 220}ms` }}
                />
              ))}
              {shapes.texts.map(([x, y, w, h], i) => (
                <rect
                  key={`t${i}`}
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  fill="rgb(255 46 136 / 0.18)"
                  stroke={MAGENTA}
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                  className="live-pop"
                  style={{ animationDelay: `${shapes.panels.length * 220 + i * 60}ms` }}
                />
              ))}
            </svg>
          )}
          {/* Los números aparte del SVG estirado: así quedan redondos. */}
          {shapes?.panels.map((poly, i) => {
            const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
            const cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
            return (
              <span
                key={`n${i}`}
                className="live-pop absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[12px] font-black"
                style={{ left: `${cx * 100}%`, top: `${cy * 100}%`, background: CYAN, color: INK, animationDelay: `${i * 220 + 150}ms` }}
              >
                {i + 1}
              </span>
            );
          })}
        </div>
        {shapes && (
          <p className="mt-2 text-center text-[12px] font-medium" style={{ color: "#A6A6B0" }}>
            {L.found(shapes.panels.length, shapes.texts.length)}
          </p>
        )}
      </div>

      {/* Los pasos, con el actual resaltado, y su animación. */}
      <div className="min-w-0">
        <h2 className="font-[family-name:var(--display)] text-[20px] uppercase tracking-wide" style={{ color: PAPER }}>
          {L.title}
        </h2>
        <ol className="mt-3 space-y-2.5">
          {L.steps.map((s, i) => (
            <li key={s.title} className="flex gap-3 transition-opacity duration-300" style={{ opacity: i === step ? 1 : i < step ? 0.55 : 0.35 }}>
              <span
                className="mt-0.5 flex size-6 shrink-0 items-center justify-center font-[family-name:var(--display)] text-[13px]"
                style={{ background: i === step ? CYAN : i < step ? PAPER : "transparent", color: INK, border: `2px solid ${i <= step ? "transparent" : "#6E6E78"}` }}
              >
                {i < step ? "✓" : i + 1}
              </span>
              <span>
                <span className="block text-[15px] font-bold" style={{ color: PAPER }}>
                  {s.title}
                </span>
                {i === step && (
                  <span className="block text-[13px] leading-snug" style={{ color: "#A6A6B0" }}>
                    {s.body}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-4 max-w-[20rem] max-sm:mx-auto">{scenes[step]}</div>
      </div>
    </section>
  );
}

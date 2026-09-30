"use client";

import { useEffect, useRef, useState } from "react";
import { etaText, noteText, useI18n, type Messages } from "@/lib/i18n";
import type { Note } from "@/lib/notes";

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
  /** 0..1, o null mientras no se sabe cuántas páginas hay. */
  progress: number | null;
  /** Segundos que faltan, o null mientras no hay con qué estimarlo. */
  eta: number | null;
};

export function Processing({ title, stage, lines, progress, eta }: ProcessingProps) {
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

      <div className="relative mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center gap-5">
        <section
          className="border-[4px] px-6 py-7 sm:px-10 sm:py-10"
          style={{ borderColor: INK, background: PAPER, boxShadow: "12px 12px 0 #0A0A0C" }}
        >
          <p
            className="mb-3 font-[family-name:var(--display)] text-[13px] tracking-wide"
            style={{ color: "#3A3A42" }}
          >
            {P.label} · {title}
          </p>

          <h1
            className="font-[family-name:var(--display)] uppercase leading-[0.9]"
            style={{
              fontSize: "clamp(2.2rem,7vw,5rem)",
              color: INK,
              textShadow: `0.04em 0 0 ${CYAN}, -0.04em 0 0 ${MAGENTA}`,
            }}
          >
            {headline(t, stage)}
          </h1>

          <p className="mt-4 text-[16px] font-medium sm:text-[19px]" style={{ color: "#24242A" }}>
            {detail(t, stage)}
            <span aria-hidden>{".".repeat(1 + (tick % 3))}</span>
          </p>

          {/* La barra: segmentada, como una tira de viñetas que se va llenando. */}
          <div className="mt-7 flex items-center gap-4">
            <div className="flex h-6 flex-1 gap-[3px]">
              {Array.from({ length: 28 }, (_, i) => {
                const filled = pct !== null && (i + 1) / 28 <= progress!;
                const edge = pct !== null && Math.abs((i + 0.5) / 28 - progress!) < 1 / 28;
                return (
                  <span
                    key={i}
                    className="flex-1"
                    style={{
                      border: `2px solid ${INK}`,
                      background: filled ? INK : edge ? CYAN : "transparent",
                    }}
                  />
                );
              })}
            </div>
            <span
              className="w-16 text-right font-[family-name:var(--display)] text-2xl tabular-nums"
              style={{ color: INK }}
            >
              {pct === null ? "··" : `${pct}%`}
            </span>
          </div>

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
        </section>

        {/* El registro: qué fue encontrando, línea por línea. */}
        <section
          ref={logRef}
          className="max-h-52 overflow-y-auto border-[4px] px-5 py-4"
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

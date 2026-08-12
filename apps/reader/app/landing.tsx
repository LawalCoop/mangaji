"use client";

import { useRef, useState } from "react";

/**
 * Portada del lector.
 *
 * La página está maquetada como una página de manga: viñetas de bordes de tinta separadas
 * por gutters, con una onomatopeya cruzándola como en un cuadro de impacto. Las viñetas
 * entran en orden de lectura —derecha primero— así que la primera cosa que hace la página
 * es demostrar de qué se trata.
 *
 * El color aparece solo donde actúa el producto: entra tinta, sale movimiento.
 */

type Props = {
  status: "idle" | "loading" | "error";
  message?: string;
  onFile: (file: File) => void;
};

const INK = "#141419";
const CYAN = "#00d9e8";
const MAGENTA = "#ff2e63";

/** Trama de puntos: el gris del manga. */
const SCREENTONE =
  "radial-gradient(circle at 1px 1px, rgba(20,20,26,.3) 1px, transparent 0) 0 0 / 6px 6px";

export function Landing({ status, message, onFile }: Props) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const take = (file: File | undefined) => {
    if (file) onFile(file);
  };

  return (
    <div className="landing relative min-h-dvh overflow-hidden bg-[#101014] text-[#141419]">
      {/* Líneas de velocidad convergiendo: el fondo de un cuadro de impacto. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "repeating-conic-gradient(from 0deg at 62% 38%, #ffffff 0deg 0.4deg, transparent 0.4deg 1.9deg)",
          maskImage: "radial-gradient(circle at 62% 38%, transparent 18%, black 72%)",
          WebkitMaskImage: "radial-gradient(circle at 62% 38%, transparent 18%, black 72%)",
          opacity: 0.5,
        }}
      />

      {/* Onomatopeya: la pieza que domina la página, como en una doble de batalla. */}
      <span
        aria-hidden
        className="onomatopoeia pointer-events-none absolute select-none font-[family-name:var(--font-display)] uppercase"
        style={{
          top: "24%",
          left: "-4%",
          fontSize: "clamp(9rem, 26vw, 26rem)",
          lineHeight: 0.8,
          transform: "rotate(-11deg)",
          color: "transparent",
          WebkitTextStroke: `3px rgba(255,255,255,.16)`,
        }}
      >
        Dokaan
      </span>

      <main className="relative mx-auto flex min-h-dvh max-w-6xl flex-col gap-3 px-4 py-5 sm:gap-4 sm:px-6 sm:py-8">
        <header className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-[1fr_170px]">
          {/* Entra segunda: en manga, la izquierda se lee después. */}
          <Panel className="order-2 px-6 py-8 sm:px-10 sm:py-11 lg:order-1" tone="paper" beat={2}>
            <div className="mb-6 flex flex-wrap items-baseline gap-3">
              <span className="inline-block bg-[#141419] px-3 py-1.5 font-[family-name:var(--font-display)] text-xl uppercase tracking-[0.16em] text-white">
                Mangaji
              </span>
              <span className="text-[10px] font-bold uppercase tracking-[0.34em] text-[#6f6b62]">
                Lector de manga
              </span>
            </div>
            <h1 className="font-[family-name:var(--font-display)] text-[clamp(3.2rem,10.5vw,7.5rem)] leading-[0.82] uppercase">
              <span className="block" style={chromatic}>
                Tu manga
              </span>
              <span className="relative block">
                <span style={chromatic}>dirigido</span>
                {/* Subrayado a mano alzada, como el énfasis de un globo. */}
                <svg
                  aria-hidden
                  viewBox="0 0 300 12"
                  preserveAspectRatio="none"
                  className="absolute -bottom-1 left-0 h-3 w-[62%]"
                >
                  <path
                    d="M2 8 C 60 2, 120 11, 180 5 S 280 3, 298 7"
                    fill="none"
                    stroke={MAGENTA}
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
            </h1>
            <p className="mt-7 max-w-lg text-[15px] leading-relaxed text-[#3a3833] sm:text-base">
              Se lee viñeta por viñeta, con la cámara viajando por la página y el diálogo
              apareciendo cuando le toca. Como ver el capítulo, pero seguís siendo vos quien
              marca el ritmo.
            </p>
          </Panel>

          {/* Entra primera: es la de la derecha. */}
          <Panel
            className="order-1 flex items-center justify-center gap-4 px-6 py-4 lg:order-2 lg:flex-col lg:py-10"
            tone="ink"
            beat={1}
          >
            <span
              className="font-[family-name:var(--font-display)] text-4xl leading-none"
              style={{ color: CYAN }}
            >
              ←
            </span>
            <span className="text-center text-[10px] font-bold uppercase leading-[1.5] tracking-[0.22em] text-[#a5a19a]">
              se lee de
              <br />
              derecha a
              <br />
              izquierda
            </span>
          </Panel>
        </header>

        {/* La viñeta vacía: acá entra el tomo. */}
        <Panel tone="paper" beat={3} className="grow">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              take(e.dataTransfer.files?.[0]);
            }}
            className="relative flex h-full min-h-[260px] flex-col items-center justify-center gap-7 overflow-hidden p-8 text-center"
          >
            {/* Al arrastrar encima, la viñeta se enciende: el producto en acto. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 transition-opacity duration-200"
              style={{
                opacity: over ? 1 : 0,
                background:
                  "repeating-conic-gradient(from 0deg at 50% 50%, rgba(0,217,232,.5) 0deg 0.5deg, transparent 0.5deg 2.4deg)",
              }}
            />

            <div className="relative">
              <div
                className="relative border-[3px] px-9 py-7 transition-all duration-200 sm:px-14 sm:py-9"
                style={{
                  borderColor: INK,
                  background: over ? CYAN : "#fff",
                  borderRadius: "48% 52% 50% 50% / 60% 44% 56% 40%",
                  transform: over ? "scale(1.04) rotate(-1deg)" : "none",
                }}
              >
                <p className="font-[family-name:var(--font-display)] text-[clamp(1.5rem,4vw,2.6rem)] uppercase leading-none">
                  {status === "loading" ? "Abriendo…" : "Soltá tu tomo acá"}
                </p>
                <p className="mt-2 text-xs font-medium text-[#3a3833]">
                  CBZ, o el .cbza ya procesado
                </p>
              </div>
              <div
                aria-hidden
                className="absolute left-1/2 h-7 w-7 -translate-x-8 rotate-45 border-b-[3px] border-r-[3px] transition-colors"
                style={{ bottom: -15, borderColor: INK, background: over ? CYAN : "#fff" }}
              />
            </div>

            <button
              type="button"
              onClick={() => input.current?.click()}
              className="group relative inline-flex items-center gap-3 border-[3px] bg-[#141419] px-8 py-3.5 text-white transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4"
              style={{ borderColor: INK, boxShadow: `5px 5px 0 ${MAGENTA}`, outlineColor: MAGENTA }}
            >
              <span className="font-[family-name:var(--font-display)] text-xl uppercase tracking-wide">
                Elegir archivo
              </span>
              <span className="transition-transform group-hover:translate-x-1" style={{ color: CYAN }}>
                ▸
              </span>
            </button>
            <input
              ref={input}
              type="file"
              accept=".cbza,.cbz,.zip,application/zip"
              className="hidden"
              onChange={(e) => take(e.target.files?.[0])}
            />

            <p className="relative max-w-sm text-xs font-medium leading-relaxed text-[#6f6b62]">
              {status === "error" && message ? (
                <span className="font-bold text-[#c31d45]">{message}</span>
              ) : (
                "Nada se sube a ningún servidor: el archivo se abre en tu navegador y se queda en tu máquina."
              )}
            </p>
          </div>
        </Panel>

        {/* Tira de tres: se lee de derecha a izquierda, como el resto. */}
        <section className="grid gap-3 sm:gap-4 md:grid-cols-3" dir="rtl">
          <Step n="１" title="Encuentra las viñetas" tone="tone" beat={4}>
            Reconoce cada cuadro y en qué orden se leen, incluso con los cortes diagonales de
            una página de batalla.
          </Step>
          <Step n="２" title="Mueve la cámara" tone="paper" beat={5}>
            Encuadra viñeta por viñeta y viaja entre ellas. Las de acción entran secas; las
            tranquilas, con calma.
          </Step>
          <Step n="３" title="Suelta el diálogo" tone="tone" beat={6}>
            Saca el texto de los globos y lo devuelve a su tiempo, con la pausa que pide cada
            parlamento.
          </Step>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-3 pt-1 text-[11px] font-medium uppercase tracking-[0.22em] text-[#7d796f]">
          <span>
            Desarrollado por{" "}
            <span className="font-bold" style={{ color: CYAN }}>
              lawal
            </span>
          </span>
          <span className="text-[#5a5750]">Corre entero en tu navegador</span>
        </footer>
      </main>

    </div>
  );
}

/** Aberración cromática: el desdoblamiento de color del cuadro de impacto. */
const chromatic: React.CSSProperties = {
  textShadow: `0.05em 0 0 ${CYAN}, -0.05em 0 0 ${MAGENTA}`,
};

/**
 * Viñeta: borde de tinta, esquina recortada y sombra dura.
 *
 * `beat` es su lugar en el orden de lectura, y de ahí sale el retraso con que entra: la
 * página se arma de derecha a izquierda, que es una demostración de lo que hace el producto.
 */
function Panel({
  children,
  className = "",
  tone = "paper",
  beat = 1,
}: {
  children: React.ReactNode;
  className?: string;
  tone?: "paper" | "ink" | "tone";
  beat?: number;
}) {
  const background = tone === "ink" ? "#1c1c22" : tone === "tone" ? "#eeebe3" : "#f7f5f0";
  return (
    <div
      className={`panel border-[3px] ${className}`}
      style={{
        borderColor: INK,
        background: tone === "tone" ? `${SCREENTONE}, #eeebe3` : background,
        boxShadow: "7px 7px 0 rgba(0,0,0,.55)",
        clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 20px), calc(100% - 20px) 100%, 0 100%)",
        animationDelay: `${beat * 90}ms`,
      }}
    >
      {children}
    </div>
  );
}

function Step({
  n,
  title,
  children,
  tone,
  beat,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
  tone: "paper" | "tone";
  beat: number;
}) {
  return (
    <Panel tone={tone} beat={beat} className="px-5 py-5 text-right">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="font-[family-name:var(--font-display)] text-xl uppercase">{title}</span>
        <span className="font-[family-name:var(--font-display)] text-3xl text-[#c9c4b8]">{n}</span>
      </div>
      <p className="text-[13px] font-medium leading-relaxed text-[#3a3833]">{children}</p>
    </Panel>
  );
}

"use client";

import { useRef, useState } from "react";

/**
 * Portada del lector.
 *
 * La página está maquetada como una página de manga: viñetas de bordes inclinados separadas
 * por gutters, y el área de carga es la viñeta vacía —la que espera tu tomo—. El color
 * aparece solo donde actúa el producto, que es la idea que vende: entra tinta, sale
 * movimiento.
 */

type Props = {
  status: "idle" | "loading" | "error";
  message?: string;
  onFile: (file: File) => void;
};

/** Trama de puntos, el relleno de gris del manga. */
const SCREENTONE =
  "radial-gradient(circle at 1px 1px, rgba(20,20,26,.28) 1px, transparent 0) 0 0 / 6px 6px";

export function Landing({ status, message, onFile }: Props) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const take = (file: File | undefined) => {
    if (file) onFile(file);
  };

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#141419] text-[#141419]">
      {/* Líneas de velocidad: el fondo de una viñeta de impacto. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          background:
            "repeating-conic-gradient(from 0deg at 50% 42%, #ffffff 0deg 0.35deg, transparent 0.35deg 2.2deg)",
          maskImage: "radial-gradient(circle at 50% 42%, transparent 32%, black 78%)",
          WebkitMaskImage: "radial-gradient(circle at 50% 42%, transparent 32%, black 78%)",
        }}
      />

      <main className="relative mx-auto flex min-h-dvh max-w-6xl flex-col gap-3 px-4 py-6 sm:gap-4 sm:px-6 sm:py-10">
        {/* Tira superior: el título y el orden de lectura. */}
        <header className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-[1fr_auto]">
          <Panel className="order-2 px-6 py-8 sm:px-10 sm:py-12 lg:order-1" tone="paper">
            <p className="mb-4 text-[11px] font-bold uppercase tracking-[0.32em] text-[#6f6b62]">
              Lector de manga
            </p>
            <h1 className="font-[family-name:var(--font-display)] text-[clamp(2.6rem,8vw,5.5rem)] leading-[0.86] uppercase">
              <span className="block" style={chromatic}>
                Tu manga,
              </span>
              <span className="block" style={chromatic}>
                dirigido
              </span>
            </h1>
            <p className="mt-6 max-w-lg text-[15px] leading-relaxed text-[#3a3833] sm:text-base">
              Se lee viñeta por viñeta, con la cámara viajando por la página y el diálogo
              apareciendo cuando le toca. Como ver el capítulo, pero seguís siendo vos quien
              marca el ritmo.
            </p>
          </Panel>

          {/* Indicador de sentido de lectura: en manga se avanza hacia la izquierda. */}
          <Panel
            className="order-1 flex items-center justify-center gap-4 px-6 py-4 lg:order-2 lg:w-[168px] lg:flex-col lg:py-10"
            tone="ink"
          >
            <span className="font-[family-name:var(--font-display)] text-3xl text-[#00d9e8]">←</span>
            <span className="text-center text-[10px] font-bold uppercase leading-tight tracking-[0.22em] text-[#a5a19a]">
              se lee de
              <br />
              derecha a
              <br />
              izquierda
            </span>
          </Panel>
        </header>

        {/* La viñeta vacía: acá entra el tomo. */}
        <Panel
          tone="paper"
          className={`relative grow transition-transform duration-200 ${over ? "scale-[1.004]" : ""}`}
        >
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
            className="flex h-full min-h-[240px] flex-col items-center justify-center gap-6 p-8 text-center"
          >
            {/* Globo de diálogo: la instrucción, dicha por la página. */}
            <div className="relative">
              <div
                className={`relative rounded-[46%_54%_50%_50%/58%_46%_54%_42%] border-[3px] border-[#141419] px-8 py-6 transition-colors sm:px-12 sm:py-8 ${
                  over ? "bg-[#00d9e8]" : "bg-white"
                }`}
              >
                <p className="font-[family-name:var(--font-display)] text-[clamp(1.3rem,3.4vw,2rem)] uppercase leading-tight">
                  {status === "loading" ? "Abriendo…" : "Soltá tu tomo acá"}
                </p>
                <p className="mt-1 text-xs text-[#3a3833]">CBZ, o el .cbza ya procesado</p>
              </div>
              {/* La cola del globo, apuntando al botón. */}
              <div
                aria-hidden
                className="absolute left-1/2 h-6 w-6 -translate-x-6 rotate-45 border-b-[3px] border-r-[3px] border-[#141419] transition-colors"
                style={{ bottom: -13, background: over ? "#00d9e8" : "#fff" }}
              />
            </div>

            <button
              type="button"
              onClick={() => input.current?.click()}
              className="group relative inline-flex items-center gap-3 border-[3px] border-[#141419] bg-[#141419] px-7 py-3 text-white transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ff2e63]"
            >
              <span className="font-[family-name:var(--font-display)] text-lg uppercase tracking-wide">
                Elegir archivo
              </span>
              <span className="text-[#ff2e63] transition-transform group-hover:translate-x-1">▸</span>
            </button>
            <input
              ref={input}
              type="file"
              accept=".cbza,.cbz,.zip,application/zip"
              className="hidden"
              onChange={(e) => take(e.target.files?.[0])}
            />

            <p className="max-w-sm text-xs leading-relaxed text-[#6f6b62]">
              {status === "error" && message ? (
                <span className="font-bold text-[#c31d45]">{message}</span>
              ) : (
                "Nada se sube a ningún servidor: el archivo se abre en tu navegador y se queda en tu máquina."
              )}
            </p>
          </div>
        </Panel>

        {/* Tira de tres viñetas: lo que hace, en orden de lectura. */}
        <section className="grid gap-3 sm:gap-4 md:grid-cols-3" dir="rtl">
          <Step n="１" title="Encuentra las viñetas" tone="tone">
            Reconoce cada cuadro y en qué orden se leen, incluso con los cortes diagonales de
            una página de batalla.
          </Step>
          <Step n="２" title="Mueve la cámara" tone="paper">
            Encuadra viñeta por viñeta y viaja entre ellas. Las de acción entran secas; las
            tranquilas, con calma.
          </Step>
          <Step n="３" title="Suelta el diálogo" tone="tone">
            Saca el texto de los globos y lo devuelve a su tiempo, con la pausa que pide cada
            parlamento.
          </Step>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-3 pt-1 text-[11px] uppercase tracking-[0.22em] text-[#7d796f]">
          <span>
            Desarrollado por <span className="font-bold text-[#eeebe3]">lawal</span>
          </span>
          <span className="text-[#5a5750]">Corre entero en tu navegador</span>
        </footer>
      </main>
    </div>
  );
}

/** Aberración cromática: el desdoblamiento de color del cuadro de impacto. */
const chromatic: React.CSSProperties = {
  textShadow: "0.055em 0 0 #00d9e8, -0.055em 0 0 #ff2e63",
};

/** Viñeta: bordes de tinta y una esquina cortada en diagonal. */
function Panel({
  children,
  className = "",
  tone = "paper",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: "paper" | "ink" | "tone";
}) {
  const background =
    tone === "ink" ? "#1c1c22" : tone === "tone" ? `#eeebe3` : "#f7f5f0";
  return (
    <div
      className={`border-[3px] border-[#141419] shadow-[6px_6px_0_rgba(0,0,0,0.45)] ${className}`}
      style={{
        background: tone === "tone" ? `${SCREENTONE}, #eeebe3` : background,
        // La esquina recortada es lo que hace que se lea como viñeta y no como tarjeta.
        clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 18px), calc(100% - 18px) 100%, 0 100%)",
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
}: {
  n: string;
  title: string;
  children: React.ReactNode;
  tone: "paper" | "tone";
}) {
  return (
    <Panel tone={tone} className="px-5 py-5 text-right">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="font-[family-name:var(--font-display)] text-xl">{title}</span>
        <span className="font-[family-name:var(--font-display)] text-2xl text-[#c9c4b8]">{n}</span>
      </div>
      <p className="text-[13px] leading-relaxed text-[#3a3833]">{children}</p>
    </Panel>
  );
}

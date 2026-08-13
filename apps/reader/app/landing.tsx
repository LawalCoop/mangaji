"use client";

import { useRef, useState } from "react";

/**
 * Portada de Mangaji.
 *
 * La página está maquetada como una página de manga: paneles de tinta separados por gutters,
 * la tira de capacidades numerada de derecha a izquierda, y el área de carga como el cuadro
 * que espera el tomo. Implementa el diseño hecho en Pencil.
 */

type Props = {
  status: "idle" | "loading" | "error";
  message?: string;
  onFile: (file: File) => void;
};

const INK = "#0B0B0C";
const PAPER = "#F4EFE3";
const CYAN = "#00D9F5";
const MAGENTA = "#FF2E88";

/** Marco de tinta con sombra dura: el borde de un cuadro impreso. */
const panel = {
  background: PAPER,
  border: `4px solid ${INK}`,
  boxShadow: `12px 12px 0 #0A0A0C`,
} as const;

/** Trama de puntos, el gris del manga. */
const TONE = `radial-gradient(circle at 1px 1px, ${INK}2e 1.6px, transparent 0) 0 0 / 9px 9px`;

export function Landing({ status, message, onFile }: Props) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const take = (file: File | undefined) => {
    if (file) onFile(file);
  };

  return (
    <div className="landing relative min-h-dvh w-full overflow-hidden bg-[#121214] px-4 py-5 sm:px-8 sm:py-9">
      {/* Onomatopeya de fondo: apenas más clara que el papel del canvas. */}
      <span
        aria-hidden
        className="pointer-events-none absolute select-none font-[family-name:var(--font-kana)] font-black"
        style={{
          left: "-2%",
          top: "34%",
          fontSize: "clamp(11rem, 30vw, 26rem)",
          letterSpacing: "0.05em",
          color: "#1A1A20",
          transform: "rotate(-12deg)",
          transformOrigin: "top left",
          whiteSpace: "nowrap",
        }}
      >
        ドォン
      </span>

      <div className="relative mx-auto flex w-full max-w-[1440px] flex-col gap-[18px]">
        {/* Encabezado */}
        <header
          className="panel flex flex-wrap items-center justify-between gap-4 px-5 py-3 sm:px-7"
          style={panel}
        >
          <div className="flex flex-wrap items-baseline gap-3 sm:gap-4">
            <span
              className="font-[family-name:var(--font-display)] leading-none"
              style={{ fontSize: "clamp(2rem,5vw,3.5rem)", color: INK }}
            >
              MANGAJI
            </span>
            <span className="h-6 w-1" style={{ background: MAGENTA }} aria-hidden />
            <span className="text-[15px] font-medium sm:text-[19px]" style={{ color: INK }}>
              Lector de manga
            </span>
          </div>
          <span
            className="font-[family-name:var(--font-kana)] text-[22px] font-bold"
            style={{ color: "#4A4A50" }}
          >
            漫画児
          </span>
        </header>

        {/* Hero: sentido de lectura + titular */}
        <div className="flex flex-col gap-[18px] lg:flex-row">
          <aside
            className="panel flex shrink-0 flex-col gap-5 px-6 py-6 lg:w-[228px]"
            style={{ ...panel, backgroundImage: TONE }}
          >
            <p
              className="font-[family-name:var(--font-display)] text-[17px] leading-tight"
              style={{ color: INK }}
            >
              SENTIDO DE LECTURA
            </p>
            <span
              className="font-[family-name:var(--font-display)] leading-none"
              style={{ fontSize: "clamp(3rem,9vw,5rem)", color: INK }}
              aria-hidden
            >
              ←
            </span>
            <p className="text-[17px] font-medium leading-snug" style={{ color: INK }}>
              De derecha a izquierda y de arriba abajo, como el original en papel.
            </p>
          </aside>

          <section
            className="panel relative flex-1 overflow-hidden px-6 py-7 sm:px-9 sm:py-9"
            style={panel}
          >
            {/* La onomatopeya del cuadro, contorneada sobre el papel. */}
            <span
              aria-hidden
              className="pointer-events-none absolute select-none font-[family-name:var(--font-kana)] font-black"
              style={{
                right: "-3%",
                top: "12%",
                fontSize: "clamp(5rem,13vw,10.75rem)",
                letterSpacing: "0.04em",
                color: PAPER,
                WebkitTextStroke: `3px ${INK}`,
                transform: "rotate(4deg)",
                whiteSpace: "nowrap",
              }}
            >
              ドォン
            </span>

            <div className="relative flex items-center gap-3">
              <span className="h-5 w-2" style={{ background: INK }} aria-hidden />
              <p
                className="font-[family-name:var(--font-display)] text-[13px] tracking-wide sm:text-[19px]"
                style={{ color: "#3A3A42" }}
              >
                LECTOR DE CBZ · TODO PASA EN TU NAVEGADOR
              </p>
            </div>

            {/* Titular en tres capas desplazadas: el desdoblamiento del cuadro de impacto. */}
            <h1 className="relative mt-5" style={{ lineHeight: 0.92 }}>
              <span className="sr-only">Tu manga, animeizado</span>
              {[
                { color: MAGENTA, x: 20, y: 17 },
                { color: CYAN, x: 10, y: 8 },
                { color: INK, x: 0, y: 0 },
              ].map((layer, i) => (
                <span
                  key={layer.color}
                  aria-hidden
                  className="font-[family-name:var(--font-display)] whitespace-nowrap"
                  style={{
                    display: "block",
                    position: i === 2 ? "relative" : "absolute",
                    left: layer.x,
                    top: layer.y,
                    fontSize: "clamp(2.6rem,9.5vw,9.5rem)",
                    letterSpacing: "-0.01em",
                    color: layer.color,
                  }}
                >
                  TU MANGA,
                  <br />
                  ANIMEIZADO
                </span>
              ))}
            </h1>

            <p
              className="relative mt-7 max-w-[620px] text-[17px] font-medium leading-[1.6] sm:text-[21px]"
              style={{ color: "#24242A" }}
            >
              Mangaji abre tus archivos CBZ y, en vez de dejarte la página entera enfrente, la
              recorre: encuadra cada viñeta, viaja hasta la siguiente y muestra el diálogo cuando
              le toca. Como ver el capítulo, salvo que el ritmo lo marcás vos.
            </p>
          </section>
        </div>

        {/* El cuadro que espera el tomo. */}
        <section
          className="panel relative"
          style={{ ...panel, background: over ? CYAN : PAPER, transition: "background 160ms" }}
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
        >
          {/* Marcas de esquina, como las de registro de imprenta. */}
          {[
            { top: 14, left: 14 },
            { top: 14, right: 14 },
            { bottom: 14, left: 14 },
            { bottom: 14, right: 14 },
          ].map((pos, i) => (
            <span
              key={i}
              aria-hidden
              className="pointer-events-none absolute h-4 w-4"
              style={{
                ...pos,
                borderTop: pos.top !== undefined ? `3px solid ${INK}` : undefined,
                borderBottom: pos.bottom !== undefined ? `3px solid ${INK}` : undefined,
                borderLeft: pos.left !== undefined ? `3px solid ${INK}` : undefined,
                borderRight: pos.right !== undefined ? `3px solid ${INK}` : undefined,
              }}
            />
          ))}

          <div className="flex flex-col items-center gap-5 px-6 py-9 text-center sm:py-12">
            {/* Globo de diálogo: la instrucción, dicha por la página. */}
            <div className="relative">
              <div
                className="border-[4px] bg-white px-8 py-5 sm:px-12 sm:py-6"
                style={{
                  borderColor: INK,
                  borderRadius: "48% 52% 50% 50% / 58% 45% 55% 42%",
                }}
              >
                <p
                  className="font-[family-name:var(--font-display)] leading-none"
                  style={{ fontSize: "clamp(1.5rem,4.5vw,2.875rem)", color: INK }}
                >
                  {status === "loading" ? "ABRIENDO…" : "SUBÍ TU TOMO ACÁ"}
                </p>
              </div>
              <span
                aria-hidden
                className="absolute left-1/2 h-6 w-6 -translate-x-9 rotate-45 border-b-[4px] border-r-[4px] bg-white"
                style={{ bottom: -14, borderColor: INK }}
              />
            </div>

            <button
              type="button"
              onClick={() => input.current?.click()}
              className="inline-flex items-center gap-3 border-[4px] px-7 py-3 transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-4"
              style={{ borderColor: INK, background: INK, outlineColor: MAGENTA }}
            >
              <span aria-hidden style={{ color: CYAN }}>
                ▶
              </span>
              <span
                className="font-[family-name:var(--font-display)] leading-none"
                style={{ fontSize: "clamp(1.15rem,3vw,1.875rem)", color: PAPER }}
              >
                ELEGIR ARCHIVO
              </span>
            </button>
            <input
              ref={input}
              type="file"
              accept=".cbza,.cbz,.zip,application/zip"
              className="hidden"
              onChange={(e) => take(e.target.files?.[0])}
            />

            <p className="text-[16px] font-medium sm:text-[19px]" style={{ color: "#3A3A42" }}>
              Abrí un .cbz. Si ya lo procesaste antes, el .cbza carga directo.
            </p>
            <p className="max-w-lg text-[14px] font-medium leading-relaxed" style={{ color: "#5A5A62" }}>
              {status === "error" && message ? (
                <span style={{ color: "#C31D45", fontWeight: 700 }}>{message}</span>
              ) : (
                "El archivo no sale de tu máquina: se abre y se procesa en tu navegador, sin pasar por ningún servidor."
              )}
            </p>
          </div>
        </section>

        {/* Capacidades: numeradas al revés, porque se leen de derecha a izquierda. */}
        <div className="grid gap-[18px] md:grid-cols-3">
          {[
            {
              n: "03",
              title: "MUESTRA EL DIÁLOGO",
              text: "Detecta los globos y muestra cada parlamento cuando le toca, con la pausa que pide la escena.",
              icon: "▭",
            },
            {
              n: "02",
              title: "MUEVE LA CÁMARA",
              text: "Encuadra una viñeta a la vez y se desplaza hasta la siguiente. En las escenas de acción corta seco; en las pausadas, viaja lento.",
              icon: "◱",
            },
            {
              n: "01",
              title: "ENCUENTRA LAS VIÑETAS",
              text: "Analiza la página y la separa cuadro por cuadro. Deduce en qué orden se leen, aun cuando la composición se parte en diagonales.",
              icon: "▦",
            },
          ].map((cap) => (
            <section
              key={cap.n}
              className="panel flex flex-col gap-3 px-6 py-6"
              style={{ ...panel, backgroundImage: TONE }}
            >
              <div className="flex items-start justify-between gap-4">
                <span className="text-[26px] leading-none" style={{ color: INK }} aria-hidden>
                  {cap.icon}
                </span>
                <span
                  className="font-[family-name:var(--font-display)] leading-none"
                  style={{ fontSize: "clamp(2.6rem,5vw,4.75rem)", color: INK }}
                >
                  {cap.n}
                </span>
              </div>
              <h2
                className="font-[family-name:var(--font-display)] leading-tight"
                style={{ fontSize: "clamp(1.4rem,2.6vw,2.25rem)", color: INK }}
              >
                {cap.title}
              </h2>
              <p className="text-[16px] font-medium leading-relaxed sm:text-[18px]" style={{ color: "#2E2E36" }}>
                {cap.text}
              </p>
            </section>
          ))}
        </div>

        <footer
          className="panel flex items-center justify-between gap-4 px-6 py-3"
          style={{ ...panel, background: "#0F0F12", border: `4px solid ${INK}` }}
        >
          <span className="text-[15px] font-medium sm:text-[17px]" style={{ color: "#8A8A94" }}>
            Desarrollado por <span style={{ color: PAPER, fontWeight: 700 }}>lawal</span>
          </span>
          <span
            className="font-[family-name:var(--font-kana)] text-[18px] font-bold"
            style={{ color: "#5A5A62" }}
          >
            終
          </span>
        </footer>
      </div>
    </div>
  );
}

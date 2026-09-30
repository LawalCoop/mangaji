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
  /** Abrir desde un link en vez de un archivo del dispositivo. */
  onUrl: (link: string) => void;
  /** Progreso de la descarga, si el tomo se está bajando de un link. */
  download: { received: number; total: number | null } | null;
};

/** Megas, con un decimal solo cuando hace falta. */
function mb(bytes: number): string {
  const v = bytes / 1024 / 1024;
  return v < 10 ? v.toFixed(1) : String(Math.round(v));
}

/** Lo que se puede abrir. */
const ACCEPT = ".cbza,.cbz,.cbr,.zip,.rar,application/zip";

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

export function Landing({ status, message, onFile, onUrl, download }: Props) {
  const [over, setOver] = useState(false);
  const [link, setLink] = useState("");
  const downloading = status === "loading" && download !== null;
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
            className="font-[family-name:var(--font-kana)] text-[22px] font-bold max-sm:hidden"
            style={{ color: "#4A4A50" }}
          >
            漫画児
          </span>
        </header>

        {/* Hero: sentido de lectura + titular. En el celular el contenedor se disuelve y el
            orden cambia: titular y carga primero, que es a lo que se viene; la explicación del
            sentido de lectura queda después. */}
        <div className="flex gap-[18px] max-lg:contents lg:flex-row">
          <aside
            className="panel flex shrink-0 flex-col gap-5 px-6 py-6 max-lg:order-3 lg:w-[228px]"
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
            className="panel relative flex-1 overflow-hidden px-6 py-7 max-lg:order-1 sm:px-9 sm:py-9"
            style={panel}
          >
            {/* La onomatopeya del cuadro, contorneada sobre el papel. En pantalla angosta no
                hay dónde ponerla sin pisar el titular. */}
            <span
              aria-hidden
              className="pointer-events-none absolute select-none font-[family-name:var(--font-kana)] font-black max-sm:hidden"
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
                LECTOR DE CBZ Y CBR · TODO PASA EN TU NAVEGADOR
              </p>
            </div>

            {/* Titular en tres capas desplazadas: el desdoblamiento del cuadro de impacto. */}
            <h1 className="relative mt-5" style={{ lineHeight: 0.92 }}>
              <span className="sr-only">Tu manga, animeizado</span>
              {/* Desplazamientos en `em`, proporcionales a la letra: en píxeles fijos, con el
                  titular chico del celular las capas se despegaban y se leían como texto aparte. */}
              {[
                { color: MAGENTA, x: "0.13em", y: "0.11em" },
                { color: CYAN, x: "0.065em", y: "0.055em" },
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
                    fontSize: "clamp(2.6rem,min(14vw,9.5vw + 2rem),9.5rem)",
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
          className="panel relative max-lg:order-2"
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
            <div className="relative mb-3 px-10 py-6 sm:px-14 sm:py-7">
              {/* Globo y cola son un solo trazo: dibujados por separado, la cola tapaba un
                  tramo del contorno y la unión se veía cortada. */}
              <svg
                aria-hidden
                className="absolute inset-0 h-full w-full overflow-visible"
                viewBox="0 0 400 110"
                preserveAspectRatio="none"
              >
                <path
                  d="M 165 105.2 A 196 51 0 1 1 205 105.9 L 158 130 Z"
                  fill="white"
                  stroke={INK}
                  strokeWidth={4}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              <p
                className="relative font-[family-name:var(--font-display)] leading-none"
                style={{ fontSize: "clamp(1.5rem,4.5vw,2.875rem)", color: INK }}
              >
                {downloading ? "BAJANDO…" : status === "loading" ? "ABRIENDO…" : "SUBÍ TU TOMO ACÁ"}
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                const el = input.current;
                if (!el) return;
                // En el celular, sin filtro: iOS no conoce .cbz ni .cbr y los deja en gris, sin
                // poder elegirlos. Lo que no se pueda abrir lo avisa el lector después.
                el.accept = matchMedia("(pointer: coarse)").matches ? "" : ACCEPT;
                el.click();
              }}
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
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => take(e.target.files?.[0])}
            />

            <p className="text-[16px] font-medium sm:text-[19px]" style={{ color: "#3A3A42" }}>
              Abrí un .cbz o .cbr. Si ya lo procesaste antes, el .cbza carga directo.
            </p>

            {/* O desde un link: práctico cuando el tomo está en la nube y no en el teléfono. */}
            <form
              className="flex w-full max-w-lg flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                onUrl(link);
              }}
            >
              <label
                htmlFor="tomo-link"
                className="font-[family-name:var(--font-display)] text-[15px] tracking-wide"
                style={{ color: "#3A3A42" }}
              >
                O PEGÁ UN LINK
              </label>
              <div className="flex gap-2">
                <input
                  id="tomo-link"
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  placeholder="https://www.dropbox.com/…/tomo.cbz"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  className="min-w-0 flex-1 border-[3px] bg-white px-3 py-2.5 text-[16px] outline-none focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2"
                  style={{ borderColor: INK, color: INK, outlineColor: MAGENTA }}
                />
                <button
                  type="submit"
                  disabled={!link.trim() || status === "loading"}
                  className="shrink-0 border-[3px] px-4 font-[family-name:var(--font-display)] text-[18px] transition-opacity disabled:opacity-40"
                  style={{ borderColor: INK, background: INK, color: PAPER }}
                >
                  ABRIR
                </button>
              </div>
              <p className="text-[13px] leading-snug" style={{ color: "#5A5A62" }}>
                Links directos, de Dropbox o de GitHub. Google Drive todavía no.
              </p>
            </form>

            {downloading && download && (
              <div className="flex w-full max-w-lg flex-col gap-1.5" role="status">
                <div className="h-3 w-full border-[3px]" style={{ borderColor: INK }}>
                  <div
                    className="h-full"
                    style={{
                      background: INK,
                      width: download.total ? `${(download.received / download.total) * 100}%` : "35%",
                    }}
                  />
                </div>
                <p className="text-[13px] font-medium tabular-nums" style={{ color: "#3A3A42" }}>
                  {download.total
                    ? `${Math.floor((download.received / download.total) * 100)} % · ${mb(download.received)} de ${mb(download.total)} MB`
                    : `${mb(download.received)} MB`}
                </p>
              </div>
            )}
            <p className="max-w-lg text-[14px] font-medium leading-relaxed" style={{ color: "#5A5A62" }}>
              {status === "error" && message ? (
                <span style={{ color: "#C31D45", fontWeight: 700 }}>{message}</span>
              ) : (
                "El archivo se abre y se procesa en tu navegador. Si viene de un link, se baja directo del sitio donde está, sin pasar por ningún servidor nuestro."
              )}
            </p>
          </div>
        </section>

        {/* Capacidades: numeradas al revés, porque se leen de derecha a izquierda. */}
        <div className="grid gap-[18px] max-lg:order-4 md:grid-cols-3">
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
          className="panel flex items-center justify-between gap-4 px-6 py-3 max-lg:order-5"
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

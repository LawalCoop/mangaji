"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { ReadingDemo } from "./reading-demo";
import { CYAN, INK, MAGENTA, PAPER, SiteFooter, SiteHeader, TONE, panel, screenPanel } from "./site";

/**
 * Portada de Mangaji.
 *
 * La página está maquetada como una página de manga: paneles de tinta separados por gutters,
 * la tira de capacidades numerada de derecha a izquierda, y el área de carga como el cuadro
 * que espera el tomo.
 *
 * Lo que tiene que impactar es una sola cosa: la demo del hero, donde se ve a la app hacer
 * lo que promete. Todo lo demás acompaña callado.
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

/**
 * Cuánto del ancho de su columna ocupa el titular, por idioma: cada uno mide distinto
 * —"ANIMEIZADO" son 4,4 em, "YOUR MANGA," y 「マンガが、」 casi 5— y con un solo valor
 * alguno quedaba corto o se salía. Medido con cada titular, dejando lugar a las capas.
 */
const HEADLINE_FIT = { es: 21.5, en: 19.2, ja: 19.2 } as const;

export function Landing({ status, message, onFile, onUrl, download }: Props) {
  const [over, setOver] = useState(false);
  const [link, setLink] = useState("");
  const downloading = status === "loading" && download !== null;
  const input = useRef<HTMLInputElement>(null);
  const { lang, t } = useI18n();
  const L = t.landing;

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
        <SiteHeader link={{ href: "/como-funciona/", label: t.site.how }} />

        {/* Hero: el titular y, al lado, la app haciendo lo que dice. En el celular el
            contenedor se disuelve y el orden cambia: titular y carga primero, que es a lo que
            se viene; la demo queda después. */}
        <div className="gap-[18px] max-lg:contents lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.42fr)]">
          <section
            className="panel @container relative flex flex-col justify-center px-6 py-8 max-lg:order-1 sm:px-10 sm:py-12"
            style={panel}
          >
            <p className="text-[15px] font-medium sm:text-[18px]" style={{ color: "#3A3A42" }}>
              {L.tagline}
            </p>

            {/* Titular en tres capas desplazadas: el desdoblamiento del cuadro de impacto.
                El tamaño sale del ancho de su columna, no de la pantalla: así llena el cuadro
                sin salirse, en cualquier idioma. */}
            <h1 className="relative mt-4 sm:mt-6" style={{ lineHeight: 0.92 }}>
              <span className="sr-only">{L.headlineLabel}</span>
              {[
                { color: MAGENTA, x: "0.13em", y: "0.11em" },
                { color: CYAN, x: "0.065em", y: "0.055em" },
                { color: INK, x: 0, y: 0 },
              ].map((layer, i) => (
                <span
                  key={layer.color}
                  aria-hidden
                  className="font-[family-name:var(--display)] whitespace-nowrap"
                  style={{
                    display: "block",
                    position: i === 2 ? "relative" : "absolute",
                    left: layer.x,
                    top: layer.y,
                    fontSize: `clamp(2.6rem, ${HEADLINE_FIT[lang]}cqi, 12.5rem)`,
                    letterSpacing: "-0.01em",
                    color: layer.color,
                  }}
                >
                  {L.headline[0]}
                  <br />
                  {L.headline[1]}
                </span>
              ))}
            </h1>

            <p
              className="relative mt-8 max-w-[34em] text-[17px] font-medium leading-[1.6] sm:text-[20px]"
              style={{ color: "#24242A" }}
            >
              {L.intro}
            </p>
          </section>

          {/* La demo va sobre el negro del lector: así se ve la hoja como se va a ver. */}
          <section
            className="panel px-5 py-5 max-lg:order-3 sm:px-7 sm:py-7"
            style={screenPanel}
          >
            <ReadingDemo label={L.demoLabel} caption={L.direction} />
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

          <div className="grid gap-9 px-6 py-10 sm:px-12 sm:py-12 lg:grid-cols-2 lg:gap-0">
            {/* Desde el dispositivo. */}
            <div className="flex flex-col items-center justify-center gap-5 text-center lg:border-r-[3px] lg:border-dashed lg:pr-12" style={{ borderColor: `${INK}55` }}>
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
                  className="trim-caps relative font-[family-name:var(--display)] leading-none"
                  style={{ fontSize: "clamp(1.5rem,3.6vw,2.5rem)", color: INK }}
                >
                  {downloading ? L.bubbleDownloading : status === "loading" ? L.bubbleOpening : L.bubbleIdle}
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
                className="inline-flex min-h-16 items-center gap-3 border-[4px] px-8 transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-4"
                style={{ borderColor: INK, background: INK, outlineColor: MAGENTA, boxShadow: `6px 6px 0 ${MAGENTA}` }}
              >
                <span aria-hidden className="text-[0.9em] leading-none" style={{ color: CYAN }}>
                  ▶
                </span>
                <span
                  className="trim-caps font-[family-name:var(--display)] leading-none"
                  style={{ fontSize: "clamp(1.25rem,2.4vw,1.75rem)", color: PAPER }}
                >
                  {L.choose}
                </span>
              </button>
              <input
                ref={input}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => take(e.target.files?.[0])}
              />

              <p className="max-w-[26em] text-[15px] font-medium leading-snug sm:text-[17px]" style={{ color: "#3A3A42" }}>
                {L.formats}
              </p>
            </div>

            {/* O desde un link: práctico cuando el tomo está en la nube y no en el teléfono. */}
            <div className="flex flex-col justify-center gap-4 lg:pl-12">
              <form
                className="flex w-full flex-col gap-2.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  onUrl(link);
                }}
              >
                <label
                  htmlFor="tomo-link"
                  className="trim-caps font-[family-name:var(--display)] text-[20px] leading-none"
                  style={{ color: INK }}
                >
                  {L.linkLabel}
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
                    className="h-12 min-w-0 flex-1 border-[3px] bg-white px-3 text-[16px] outline-none focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2"
                    style={{ borderColor: INK, color: INK, outlineColor: MAGENTA }}
                  />
                  <button
                    type="submit"
                    disabled={!link.trim() || status === "loading"}
                    className="flex h-12 shrink-0 items-center border-[3px] px-5 transition-opacity focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 disabled:opacity-40"
                    style={{ borderColor: INK, background: INK, color: PAPER, outlineColor: MAGENTA }}
                  >
                    <span className="trim-caps font-[family-name:var(--display)] text-[19px] leading-none">
                      {L.linkOpen}
                    </span>
                  </button>
                </div>
                <p className="text-[14px] leading-snug" style={{ color: "#5A5A62" }}>
                  {L.linkHelp}
                </p>
              </form>

              {downloading && download && (
                <div className="flex w-full flex-col gap-1.5" role="status">
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
                      ? L.downloaded(
                          Math.floor((download.received / download.total) * 100),
                          mb(download.received),
                          mb(download.total),
                        )
                      : L.downloadedUnknown(mb(download.received))}
                  </p>
                </div>
              )}
            </div>

            <p
              className="text-center text-[14px] font-medium leading-relaxed lg:col-span-2 lg:mx-auto lg:mt-10 lg:max-w-[46em]"
              style={{ color: "#5A5A62" }}
              role={status === "error" ? "alert" : undefined}
            >
              {status === "error" && message ? (
                <span style={{ color: "#C31D45", fontWeight: 700 }}>{message}</span>
              ) : (
                L.privacy
              )}
            </p>
          </div>
        </section>

        {/* Capacidades: numeradas al revés, porque se leen de derecha a izquierda. */}
        <div className="grid gap-[18px] max-lg:order-4 md:grid-cols-3">
          {[
            { n: "03", ...L.features[0] },
            { n: "02", ...L.features[1] },
            { n: "01", ...L.features[2] },
          ].map((cap) => (
            <section
              key={cap.n}
              className="panel flex flex-col gap-3 px-6 py-6 sm:px-7 sm:py-7"
              style={{ ...panel, backgroundImage: TONE }}
            >
              <span
                className="trim-caps self-end font-[family-name:var(--display)] leading-none"
                style={{ fontSize: "clamp(2.6rem,4.4vw,4.25rem)", color: INK }}
                aria-hidden
              >
                {cap.n}
              </span>
              <h2
                className="mt-2 font-[family-name:var(--display)] leading-tight"
                style={{ fontSize: "clamp(1.4rem,2.3vw,2rem)", color: INK }}
              >
                {cap.title}
              </h2>
              <p className="text-[16px] font-medium leading-relaxed sm:text-[17px]" style={{ color: "#2E2E36" }}>
                {cap.text}
              </p>
            </section>
          ))}
        </div>

        {/* Las tarjetas son el resumen; el detalle técnico está en su propia página. */}
        <div className="flex justify-end max-lg:order-4">
          <Link
            href="/como-funciona/"
            className="inline-flex items-center gap-3 text-[17px] font-bold underline decoration-[3px] underline-offset-[6px] transition-colors hover:text-white sm:text-[19px]"
            style={{ color: PAPER, textDecorationColor: CYAN }}
          >
            {t.landing.howLink}
          </Link>
        </div>

        <div className="max-lg:order-5">
          <SiteFooter />
        </div>
      </div>
    </div>
  );
}

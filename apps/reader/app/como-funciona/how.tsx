"use client";

import Link from "next/link";
import { I18nProvider, useI18n, type Messages } from "@/lib/i18n";
import { CYAN, INK, MAGENTA, PAPER, SiteFooter, SiteHeader, panel, screenPanel } from "../site";
import {
  DetectScene,
  DirectScene,
  LiftScene,
  OpenScene,
  OrderScene,
  PolygonScene,
  PrepareScene,
  SaveScene,
} from "./scenes";

/**
 * "Cómo funciona": el recorrido de una página, etapa por etapa.
 *
 * Está maquetada como la portada, con cuadros de tinta, pero se lee de arriba abajo como un
 * informe: cada etapa es un cuadro de texto al lado de una pantalla donde se ve ese paso.
 * Los cuadros alternan de lado, como las viñetas de una página.
 */

/** Estable: el proveedor lo usa en un efecto y una función nueva por render lo reiniciaría. */
const pageTitle = (t: Messages) => t.how.title;

/**
 * Cuánto del ancho de su columna ocupa el titular, por idioma, medido con cada uno. Son dos
 * tercios de lo que la llenaría: es una página secundaria, y un titular del tamaño del de la
 * portada le quitaba protagonismo al texto y al índice.
 */
const HEADLINE_FIT = { es: 13.6, en: 16.7, ja: 9 } as const;

const SCENES = [OpenScene, PrepareScene, DetectScene, PolygonScene, OrderScene, LiftScene, DirectScene, SaveScene];

export default function HowPage() {
  return (
    <I18nProvider title={pageTitle}>
      <How />
    </I18nProvider>
  );
}

function How() {
  const { lang, t } = useI18n();
  const H = t.how;
  const number = (i: number) => String(i + 1).padStart(2, "0");

  return (
    <main className="landing relative min-h-dvh w-full overflow-hidden bg-[#121214] px-4 py-5 sm:px-8 sm:py-9">
      {/* La onomatopeya de fondo de esta página: 仕組み, "mecanismo". */}
      <span
        aria-hidden
        className="pointer-events-none absolute select-none font-[family-name:var(--font-kana)] font-black"
        style={{
          right: "-4%",
          top: "18%",
          fontSize: "clamp(9rem, 24vw, 22rem)",
          color: "#1A1A20",
          transform: "rotate(8deg)",
          whiteSpace: "nowrap",
          writingMode: "vertical-rl",
        }}
      >
        仕組み
      </span>

      <div className="relative mx-auto flex w-full max-w-[1440px] flex-col gap-[18px]">
        <SiteHeader link={{ href: "/", label: t.site.reader }} />

        {/* Hero: armado como el de la portada. A la izquierda, en papel, el titular y de qué
            se trata; a la derecha, en el negro de pantalla donde allá va la demo, el índice. */}
        <section className="grid gap-[18px] lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.42fr)]">
          <div className="panel @container flex flex-col justify-center px-6 py-10 sm:px-10 sm:py-12" style={panel}>
            <h1 className="relative" style={{ lineHeight: 0.92 }}>
              <span className="sr-only">{H.headlineLabel}</span>
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
                    fontSize: `clamp(2.2rem, ${HEADLINE_FIT[lang]}cqi, 7.5rem)`,
                    letterSpacing: "-0.01em",
                    color: layer.color,
                  }}
                >
                  {H.headline[0]}
                  <br />
                  {H.headline[1]}
                </span>
              ))}
            </h1>
            <p
              className="relative mt-8 max-w-[34em] text-[17px] font-medium leading-[1.6] sm:text-[20px]"
              style={{ color: "#24242A" }}
            >
              {H.intro}
            </p>
          </div>

          <nav
            aria-label={H.stepsLabel}
            className="panel flex flex-col justify-center gap-5 px-6 py-8 sm:px-8 sm:py-10"
            style={screenPanel}
          >
            <h2 className="trim-caps font-[family-name:var(--display)] text-[26px] leading-none text-[#F4EFE3]">
              {H.stepsLabel}
            </h2>
            <ol className="flex flex-col">
              {H.steps.map((s, i) => (
                <li key={s.title} className="border-t border-[#2A2A31] first:border-t-0">
                  <a
                    href={`#etapa-${i + 1}`}
                    className="group flex items-baseline gap-4 py-2.5 text-[16px] font-bold text-[#E4DFD3] transition-colors hover:text-white focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#FF2E88]"
                  >
                    <span className="w-7 shrink-0 font-[family-name:var(--display)] text-[19px] font-normal tabular-nums text-[#FF2E88]">
                      {number(i)}
                    </span>
                    <span className="underline decoration-transparent decoration-2 underline-offset-4 transition-colors group-hover:decoration-[#00D9F5]">
                      {s.title}
                    </span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </section>

        {/* Las etapas: texto y pantalla, alternando de lado. */}
        {H.steps.map((s, i) => {
          const Scene = SCENES[i];
          const flip = i % 2 === 1;
          return (
            <section
              key={s.title}
              id={`etapa-${i + 1}`}
              aria-labelledby={`etapa-${i + 1}-titulo`}
              className="grid scroll-mt-6 gap-[18px] lg:grid-cols-2"
            >
              <div className="panel flex flex-col gap-5 px-6 py-8 sm:px-10 sm:py-10" style={panel}>
                <div className="flex items-end justify-between gap-4">
                  <h2
                    id={`etapa-${i + 1}-titulo`}
                    className="font-[family-name:var(--display)] leading-[0.95]"
                    style={{ fontSize: "clamp(1.9rem,3.2vw,2.9rem)", color: INK }}
                  >
                    <span className="sr-only">{H.step(i + 1)}: </span>
                    {s.title}
                  </h2>
                  <span
                    aria-hidden
                    className="trim-caps shrink-0 font-[family-name:var(--display)] leading-none"
                    style={{ fontSize: "clamp(2.6rem,4.4vw,4rem)", color: INK }}
                  >
                    {number(i)}
                  </span>
                </div>
                <p className="text-[17px] font-medium leading-[1.65]" style={{ color: "#24242A" }}>
                  {s.body}
                </p>
                <p
                  className="border-l-4 py-3 pr-4 pl-4 text-[15px] font-medium leading-[1.6]"
                  style={{ borderColor: MAGENTA, background: "#E9E2D2", color: "#2E2E36" }}
                >
                  {s.detail}
                </p>
              </div>

              <div
                className={`panel flex items-center justify-center px-5 py-6 sm:px-8 sm:py-8 ${flip ? "lg:order-first" : ""}`}
                style={screenPanel}
              >
                <div className="w-full max-w-[520px]">
                  <Scene label={s.title} t={H.scene} />
                </div>
              </div>
            </section>
          );
        })}

        {/* Cierre: de la explicación a probarlo. */}
        <section
          className="panel flex flex-col items-center gap-6 px-6 py-12 text-center sm:py-14"
          style={panel}
        >
          <h2 className="font-[family-name:var(--display)] leading-none" style={{ fontSize: "clamp(2rem,5vw,3.75rem)", color: INK }}>
            {H.closingTitle}
          </h2>
          <p className="text-[17px] font-medium" style={{ color: "#3A3A42" }}>
            {H.closing}
          </p>
          <Link
            href="/"
            className="inline-flex min-h-16 items-center gap-3 border-[4px] px-8 transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-4"
            style={{ borderColor: INK, background: INK, outlineColor: MAGENTA, boxShadow: `6px 6px 0 ${MAGENTA}` }}
          >
            <span aria-hidden className="text-[0.9em] leading-none" style={{ color: CYAN }}>
              ▶
            </span>
            <span className="trim-caps font-[family-name:var(--display)] leading-none" style={{ fontSize: "clamp(1.25rem,2.4vw,1.75rem)", color: PAPER }}>
              {t.site.reader}
            </span>
          </Link>
        </section>

        <SiteFooter />
      </div>
    </main>
  );
}

"use client";

import Link from "next/link";
import { asset } from "@/lib/base";
import { LANGS, useI18n } from "@/lib/i18n";

/**
 * Lo que comparten las páginas del sitio: la paleta, el marco de los cuadros, el
 * encabezado y el pie. La portada y "cómo funciona" tienen que sentirse el mismo libro.
 */

export const INK = "#0B0B0C";
export const PAPER = "#F4EFE3";
export const CYAN = "#00D9F5";
export const MAGENTA = "#FF2E88";
/** El negro del lector: las pantallas donde se ve la app trabajar. */
export const SCREEN = "#0F0F12";

/**
 * Marco de tinta: el borde de un cuadro impreso.
 *
 * Sin sombra dura a propósito. Sobre el fondo oscuro la sombra casi no se distingue, y al
 * lado de un cuadro negro se juntaban cuatro negros apenas distintos —fondo, borde, sombra
 * y calle— que se leían como un borde mal impreso. Los cuadros separados por calles parejas,
 * como en una página de manga, alcanzan.
 */
export const panel = {
  background: PAPER,
  border: `4px solid ${INK}`,
} as const;

/**
 * Cuadro negro, la pantalla donde se ve a la app trabajar. Lleva su propio marco gris:
 * con el borde de tinta se fundía con la calle y no se veía dónde terminaba.
 */
export const screenPanel = {
  background: SCREEN,
  border: "4px solid #2A2A31",
} as const;

/** Trama de puntos, el gris del manga. */
export const TONE = `radial-gradient(circle at 1px 1px, ${INK}2e 1.6px, transparent 0) 0 0 / 9px 9px`;

export const LAWAL_URL = "https://lawal.coop";
export const REPO_URL = "https://github.com/LawalCoop/mangaji";

/** Encabezado: la marca, un link a la otra página y el idioma. */
export function SiteHeader({ link }: { link: { href: string; label: string } }) {
  const { lang, t, setLang } = useI18n();

  /**
   * Una celda del lado derecho: toda la altura del encabezado, separada por la misma línea
   * de tinta que separa los cuadros. Así los controles son viñetas del encabezado y no
   * cajitas flotando adentro.
   */
  const cell =
    "flex touch-manipulation items-center justify-center border-l-4 font-[family-name:var(--body)] text-[15px] font-bold leading-none transition-colors focus-visible:outline focus-visible:outline-3 focus-visible:-outline-offset-[7px]";

  return (
    <header className="panel flex items-stretch justify-between" style={panel}>
      <Link href="/" className="flex min-w-0 items-center gap-3 px-5 py-3 sm:gap-4 sm:px-7 sm:py-4">
        <span
          className="trim-caps font-[family-name:var(--display)] leading-none"
          style={{ fontSize: "clamp(2rem,4.2vw,3.25rem)", color: INK }}
        >
          MANGAJI
        </span>
        <span className="h-7 w-1 shrink-0 max-sm:hidden" style={{ background: MAGENTA }} aria-hidden />
        <span
          className="truncate py-1 text-[16px] font-medium leading-tight max-md:hidden sm:text-[18px]"
          style={{ color: INK }}
        >
          {t.landing.subtitle}
        </span>
      </Link>

      <nav className="flex shrink-0 items-stretch">
        {/* En el celular no entra: ahí el link está en la página y en el pie. */}
        <Link
          href={link.href}
          className={`${cell} px-6 hover:bg-[#0B0B0C] hover:text-[#F4EFE3] max-sm:hidden`}
          style={{ borderColor: INK, color: INK, outlineColor: MAGENTA }}
        >
          {link.label}
        </Link>

        {/* Selector de idioma: a la vista, porque quien no lee español no va a buscarlo. */}
        <div role="group" aria-label={t.language} className="flex items-stretch">
          {LANGS.map((l) => {
            const active = lang === l.id;
            return (
              <button
                key={l.id}
                type="button"
                lang={l.id}
                title={l.name}
                aria-pressed={active}
                onClick={() => setLang(l.id)}
                className={`${cell} min-w-14 px-4 ${active ? "" : "hover:bg-[#0B0B0C] hover:text-[#F4EFE3]"}`}
                style={{
                  borderColor: INK,
                  background: active ? INK : "transparent",
                  color: active ? PAPER : INK,
                  outlineColor: MAGENTA,
                }}
              >
                {l.label}
              </button>
            );
          })}
        </div>
      </nav>
    </header>
  );
}

/**
 * Pie: quién lo hace, bajo qué términos y adónde seguir.
 *
 * Usa la misma grilla que las tarjetas de arriba —tres columnas con la misma separación—,
 * así las divisiones caen donde caen los huecos entre cuadros y el cierre se lee como parte
 * de la página y no como un bloque pegado abajo.
 */
export function SiteFooter() {
  const { t } = useI18n();
  const L = t.landing;

  const heading = "trim-caps font-[family-name:var(--display)] text-[24px] leading-none";
  const link =
    "w-fit text-[15px] font-bold underline decoration-2 underline-offset-4 transition-colors hover:text-white";

  return (
    <footer
      className="panel grid gap-x-[18px] py-2 md:grid-cols-3"
      style={{ ...screenPanel, color: "#B4B4BC" }}
    >
      {/* Cada columna arranca con un renglón de la misma altura: logo o título, alineados. */}
      <div className="flex flex-col gap-4 px-6 py-6 sm:px-7">
        <div className="flex h-8 items-center">
          <a href={LAWAL_URL} target="_blank" rel="noopener" className="block">
            {/* eslint-disable-next-line @next/next/no-img-element -- exportación estática, sin optimizador */}
            <img src={asset("/lawal.png")} alt="Lawal" width={621} height={137} className="h-7 w-auto" />
          </a>
        </div>
        <p className="text-[15px] leading-relaxed">{L.madeBy}</p>
        <a href={LAWAL_URL} target="_blank" rel="noopener" className={link} style={{ color: PAPER, textDecorationColor: MAGENTA }}>
          lawal.coop
        </a>
      </div>

      <div className="relative flex flex-col gap-4 px-6 py-6 max-md:border-t sm:px-7 md:before:absolute md:before:inset-y-6 md:before:-left-[9px] md:before:w-px md:before:bg-[#2A2A30]" style={{ borderColor: "#2A2A30" }}>
        <div className="flex h-8 items-center">
          <h2 className={heading} style={{ color: PAPER }}>
            {L.freeTitle}
          </h2>
        </div>
        <p className="text-[15px] leading-relaxed">{L.freeText}</p>
      </div>

      <div className="relative flex flex-col gap-4 px-6 py-6 max-md:border-t sm:px-7 md:before:absolute md:before:inset-y-6 md:before:-left-[9px] md:before:w-px md:before:bg-[#2A2A30]" style={{ borderColor: "#2A2A30" }}>
        <div className="flex h-8 items-center">
          <h2 className={heading} style={{ color: PAPER }}>
            {t.site.project}
          </h2>
        </div>
        <nav className="flex flex-col gap-3">
          <Link href="/como-funciona/" className={link} style={{ color: PAPER, textDecorationColor: CYAN }}>
            {t.site.how}
          </Link>
          <a href={REPO_URL} target="_blank" rel="noopener" className={link} style={{ color: PAPER, textDecorationColor: CYAN }}>
            {L.source}
          </a>
          <a href={`${REPO_URL}/blob/main/LICENSE`} target="_blank" rel="noopener" className={link} style={{ color: PAPER, textDecorationColor: CYAN }}>
            {L.license}
          </a>
        </nav>
      </div>
    </footer>
  );
}

"use client";

import Link from "next/link";
import { asset } from "@/lib/base";
import { LANGS, useI18n } from "@/lib/i18n";
import { LAWAL_URL, REPO_URL } from "@/lib/seo";

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

export { LAWAL_URL, REPO_URL } from "@/lib/seo";

/** Encabezado: la marca, un link a la otra página y el idioma. */
export function SiteHeader({ link }: { link: { href: string; label: string } }) {
  const { lang, t, setLang } = useI18n();

  // Los colores van en clases y no en `style`: un color en línea le gana al hover, y así
  // el hover de "Abrir el lector" dejaba la letra del mismo negro que el fondo.
  const focus = "focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-[#FF2E88]";

  return (
    <header className="panel flex items-center justify-between gap-6 px-5 py-3 sm:px-7 sm:py-4" style={panel}>
      <Link href="/" className={`flex min-w-0 items-center gap-3 sm:gap-4 ${focus}`}>
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

      {/* Un solo cuadro: el link y el idioma van en línea, sin cajas ni celdas propias. */}
      <nav className="flex shrink-0 items-center gap-5 sm:gap-7">
        {/* En el celular no entra: ahí el link está en la página y en el pie. */}
        <Link
          href={link.href}
          className={`text-[16px] font-bold text-[#0B0B0C] underline decoration-[#FF2E88] decoration-[3px] underline-offset-[7px] transition-colors hover:text-[#FF2E88] max-sm:hidden ${focus}`}
        >
          {link.label}
        </Link>

        <span className="h-7 w-0.5 bg-[#0B0B0C]/25 max-sm:hidden" aria-hidden />

        {/* Selector de idioma: a la vista, porque quien no lee español no va a buscarlo. El
            activo va en tinta y subrayado; los otros, en gris hasta que se los señala. */}
        <div role="group" aria-label={t.language} className="flex items-center gap-1">
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
                className={`touch-manipulation border-b-[3px] px-2 pt-1.5 pb-1 text-[15px] font-bold leading-none transition-colors ${focus} ${
                  active
                    ? "border-[#FF2E88] text-[#0B0B0C]"
                    : "border-transparent text-[#7A7A84] hover:border-[#0B0B0C]/30 hover:text-[#0B0B0C]"
                }`}
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
    "w-fit text-[15px] font-bold text-[#F4EFE3] underline decoration-2 underline-offset-4 transition-colors hover:text-white";

  return (
    <footer
      className="panel relative grid gap-x-[18px] py-2 md:grid-cols-3"
      style={{ ...screenPanel, color: "#B4B4BC" }}
    >
      {/* Cada columna arranca con un renglón de la misma altura: logo o título, alineados. */}
      <div className="flex flex-col gap-3 px-6 py-5 sm:gap-4 sm:px-7 sm:py-6">
        <div className="flex h-8 items-center">
          <a href={LAWAL_URL} target="_blank" rel="noopener" className="block">
            {/* eslint-disable-next-line @next/next/no-img-element -- exportación estática, sin optimizador */}
            <img src={asset("/lawal.png")} alt="Lawal" width={621} height={137} className="h-7 w-auto" />
          </a>
        </div>
        <p className="text-[15px] leading-relaxed">{L.madeBy}</p>
        <a href={LAWAL_URL} target="_blank" rel="noopener" className={`${link} decoration-[#FF2E88]`}>
          lawal.coop
        </a>
      </div>

      <div className="relative flex flex-col gap-3 px-6 py-5 max-md:border-t sm:gap-4 sm:px-7 sm:py-6 md:before:absolute md:before:inset-y-6 md:before:-left-[9px] md:before:w-px md:before:bg-[#2A2A30]" style={{ borderColor: "#2A2A30" }}>
        <div className="flex h-8 items-center">
          <h2 className={heading} style={{ color: PAPER }}>
            {L.freeTitle}
          </h2>
        </div>
        <p className="text-[14px] leading-relaxed sm:text-[15px]">{L.freeText}</p>
        {/* Si se cuentan visitas, se dice: el sitio promete no mandar nada a ningún lado. */}
        {process.env.NEXT_PUBLIC_GOATCOUNTER && (
          <p className="text-[13px] leading-relaxed text-[#8A8A94]">{t.site.stats}</p>
        )}
      </div>

      <div className="relative flex flex-col gap-3 px-6 py-5 max-md:border-t sm:gap-4 sm:px-7 sm:py-6 md:before:absolute md:before:inset-y-6 md:before:-left-[9px] md:before:w-px md:before:bg-[#2A2A30]" style={{ borderColor: "#2A2A30" }}>
        <div className="flex h-8 items-center">
          <h2 className={heading} style={{ color: PAPER }}>
            {t.site.project}
          </h2>
        </div>
        <nav className="grid grid-cols-2 gap-x-4 gap-y-3 sm:flex sm:flex-col">
          <Link href="/como-funciona/" className={`${link} decoration-[#00D9F5]`}>
            {t.site.how}
          </Link>
          <a href={REPO_URL} target="_blank" rel="noopener" className={`${link} decoration-[#00D9F5]`}>
            {L.source}
          </a>
          <a href={`${REPO_URL}/blob/main/LICENSE`} target="_blank" rel="noopener" className={`${link} decoration-[#00D9F5]`}>
            {L.license}
          </a>
          <Link href="/legal/" className={`${link} decoration-[#00D9F5]`}>
            {t.site.legal}
          </Link>
        </nav>
      </div>
      {/* Guiño: el sello de "fin" con que cierra un tomo, estampado en rojo. */}
      <span
        aria-hidden
        className="pointer-events-none absolute right-5 bottom-4 flex h-11 w-11 select-none items-center justify-center border-[3px] font-[family-name:var(--font-kana)] text-[22px] font-black leading-none"
        style={{ borderColor: "#D6204E", color: "#D6204E", transform: "rotate(-9deg)", opacity: 0.85 }}
      >
        終
      </span>
    </footer>
  );
}

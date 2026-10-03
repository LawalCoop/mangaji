"use client";

import { DocumentTitle, useI18n } from "../../lib/i18n";
import { LEGAL, LEGAL_EMAIL } from "../../lib/legal";
import { INK, SiteFooter, SiteHeader, TONE, panel } from "../site";

/**
 * Términos y privacidad: una hoja de papel entre el encabezado y el pie, sin escenas ni
 * guiños. Es para leerse con calma, así que el texto va en una sola columna angosta.
 */
export default function LegalPage() {
  const { lang, t } = useI18n();
  const L = LEGAL[lang];

  // El correo de reclamos, como link: está escrito dentro del texto de cada idioma.
  const withMail = (text: string) => {
    const at = text.indexOf(LEGAL_EMAIL);
    if (at < 0) return text;
    return (
      <>
        {text.slice(0, at)}
        <a href={`mailto:${LEGAL_EMAIL}`} className="font-bold underline decoration-[#FF2E88] decoration-2 underline-offset-4 hover:text-[#FF2E88]">
          {LEGAL_EMAIL}
        </a>
        {text.slice(at + LEGAL_EMAIL.length)}
      </>
    );
  };

  return (
    <main className="landing relative min-h-dvh w-full overflow-hidden bg-[#121214] px-4 py-5 sm:px-8 sm:py-9">
      <DocumentTitle page="legal" />
      <div className="relative mx-auto flex w-full max-w-[1440px] flex-col gap-[18px]">
        <SiteHeader link={{ href: "/", label: t.site.reader }} />

        <article className="panel relative overflow-hidden px-6 py-10 sm:px-10 sm:py-14" style={panel}>
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-40 opacity-60" style={{ background: TONE, maskImage: "linear-gradient(to bottom, #000, transparent)" }} />
          <div className="relative mx-auto flex max-w-[44rem] flex-col gap-8" style={{ color: INK }}>
            <header className="flex flex-col gap-4">
              <h1 className="trim-caps font-[family-name:var(--display)] leading-none" style={{ fontSize: "clamp(2rem, 5vw, 3.25rem)" }}>
                {L.title}
              </h1>
              <p className="text-[14px] font-medium text-[#5A5A62]">{L.updated}</p>
              <p className="text-[17px] leading-relaxed">{L.intro}</p>
            </header>

            {L.sections.map((s, i) => (
              <section key={s.title} className="flex flex-col gap-3 border-t-2 pt-6" style={{ borderColor: INK }}>
                <h2 className="flex items-baseline gap-3 font-[family-name:var(--display)] text-[22px] leading-tight">
                  <span className="text-[15px] text-[#8A8A94]">{i + 1}.</span>
                  {s.title}
                </h2>
                {s.body.map((p) => (
                  <p key={p.slice(0, 24)} className="text-[16px] leading-relaxed">
                    {withMail(p)}
                  </p>
                ))}
              </section>
            ))}
          </div>
        </article>

        <SiteFooter />
      </div>
    </main>
  );
}

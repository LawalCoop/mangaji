"use client";

import { useEffect, useState } from "react";
import type { ArchiveSource } from "../lib/archive";
import type { Director } from "../lib/director";
import { useI18n } from "../lib/i18n";
import { REACTIONS, quotesOf, reactionsOf, type Reaction } from "../lib/reactions";
import type { Rect } from "../lib/types";

/** Lado mayor de una miniatura, en píxeles. */
const THUMB = 260;

type Item = { key: string; page: number; frame: string; r?: Reaction; src: string | null };

/**
 * Todo lo que el lector marcó en el tomo: las viñetas a las que reaccionó, agrupadas por
 * emoji, y las frases que guardó. Se abre desde el botón de reacciones y solo al terminar el
 * tomo. Tocar una miniatura lleva a esa viñeta.
 */
export function MarksView({
  book,
  source,
  director,
  finished,
  onGo,
  onClose,
}: {
  book: string;
  source: ArchiveSource;
  director: Director;
  /** Se abrió al llegar al final del tomo. */
  finished: boolean;
  onGo: (page: number, frame: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const T = t.reactions;
  const [reactions] = useState(() => reactionsOf(book));
  const [quotes] = useState(() => quotesOf(book));
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});

  // Las miniaturas, de a una: cada una decodifica una página entera.
  useEffect(() => {
    let cancelled = false;
    const jobs: { key: string; make: () => Promise<string | null> }[] = [
      ...reactions.map((x) => ({
        key: `r:${x.page}:${x.frame}`,
        make: () => panelThumb(source, director, x.page - 1, x.frame),
      })),
      ...quotes.map((q) => ({
        key: `q:${q.page}:${q.layer}`,
        make: () => balloonThumb(source, director, q.page - 1, q.layer),
      })),
    ];
    void (async () => {
      for (const job of jobs) {
        if (cancelled) return;
        const src = await job.make().catch(() => null);
        if (!cancelled) setThumbs((all) => ({ ...all, [job.key]: src }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reactions, quotes, source, director]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const groups = REACTIONS.map((r) => ({
    r,
    items: reactions
      .filter((x) => x.r === r)
      .map<Item>((x) => ({ key: `r:${x.page}:${x.frame}`, page: x.page, frame: x.frame, r, src: thumbs[`r:${x.page}:${x.frame}`] ?? null })),
  })).filter((g) => g.items.length);
  const quoteItems = quotes.map<Item>((q) => ({
    key: `q:${q.page}:${q.layer}`,
    page: q.page,
    frame: q.frame,
    src: thumbs[`q:${q.page}:${q.layer}`] ?? null,
  }));
  let order = 0;

  return (
    <div
      className="absolute inset-0 z-40 flex items-end justify-center bg-black/60 backdrop-blur-sm md:items-center"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={T.marks}
        onClick={(e) => e.stopPropagation()}
        className="marks-sheet flex max-h-[86dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-neutral-700/80 bg-neutral-950/95 text-neutral-100 shadow-2xl md:rounded-2xl"
      >
        <header className="flex items-start gap-3 border-b border-neutral-800 px-5 pb-4 pt-5">
          <div className="min-w-0 flex-1">
            {finished && <p className="mb-1 text-sm text-[#FF2E88]">{T.finished}</p>}
            <h2 className="font-[family-name:var(--display)] text-2xl leading-none">{T.marks}</h2>
            {(groups.length > 0 || quoteItems.length > 0) && (
              <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums text-neutral-400">
                {groups.map((g) => (
                  <span key={g.r}>
                    <span className="emoji mr-1">{g.r}</span>
                    {g.items.length}
                  </span>
                ))}
                {quoteItems.length > 0 && (
                  <span>
                    <span className="mr-1 font-serif text-[#FF2E88]">❝</span>
                    {quoteItems.length}
                  </span>
                )}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={T.close}
            title={T.close}
            className="flex size-10 shrink-0 items-center justify-center rounded-full border border-neutral-700/80 bg-neutral-900 hover:bg-neutral-800"
          >
            <svg viewBox="0 0 24 24" aria-hidden className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>

        <div className="overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
          {groups.length === 0 && quoteItems.length === 0 && (
            <p className="max-w-prose py-8 text-sm text-neutral-400">{T.marksEmpty}</p>
          )}

          {groups.map((g) => (
            <div key={g.r} className="mb-6">
              <h3 className="mb-3 flex items-center text-sm text-neutral-300">
                <span className="emoji mr-2 text-xl">{g.r}</span>
                {T.name[g.r]}
              </h3>
              <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                {g.items.map((item) => (
                  <li key={item.key} className="marks-in" style={{ animationDelay: `${Math.min(order++, 20) * 30}ms` }}>
                    <Thumb item={item} label={T.goTo(item.page)} pageLabel={T.page(item.page)} onGo={onGo} />
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {quoteItems.length > 0 && (
            <div className="mb-2">
              <h3 className="mb-3 flex items-center text-sm text-neutral-300">
                <span className="mr-2 font-serif text-2xl leading-none text-[#FF2E88]">❝</span>
                {T.quotes}
              </h3>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {quoteItems.map((item) => (
                  <li key={item.key} className="marks-in" style={{ animationDelay: `${Math.min(order++, 20) * 30}ms` }}>
                    <Thumb item={item} label={T.goTo(item.page)} pageLabel={T.page(item.page)} onGo={onGo} quote />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function Thumb({
  item,
  label,
  pageLabel,
  onGo,
  quote = false,
}: {
  item: Item;
  label: string;
  pageLabel: string;
  onGo: (page: number, frame: string) => void;
  quote?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onGo(item.page - 1, item.frame)}
      aria-label={label}
      className={`group relative flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-lg border border-neutral-800 transition-transform hover:scale-[1.03] active:scale-95 ${
        quote ? "aspect-[4/3] bg-neutral-100" : "bg-neutral-900"
      }`}
    >
      {item.src ? (
        // eslint-disable-next-line @next/next/no-img-element -- miniatura armada en el momento
        <img src={item.src} alt="" className={`h-full w-full ${quote ? "object-contain p-2" : "object-cover"}`} />
      ) : (
        <span className="h-full w-full animate-pulse bg-neutral-800/60" />
      )}
      <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] tabular-nums text-neutral-200">
        {pageLabel}
      </span>
      {item.r && (
        <span className="emoji absolute right-1 top-1 flex size-7 items-center justify-center rounded-full border border-white/90 bg-neutral-900/95 text-sm">
          {item.r}
        </span>
      )}
    </button>
  );
}

/** La viñeta recortada de su página, en chico. */
async function panelThumb(source: ArchiveSource, director: Director, page: number, frame: string): Promise<string | null> {
  const bitmap = await source.peek(page);
  if (bitmap.width === 0) return null;
  const rect: Rect = director.framesOfPage(page).find((f) => f.id === frame)?.rect ?? {
    x: 0,
    y: 0,
    w: bitmap.width,
    h: bitmap.height,
  };
  return crop(bitmap, rect);
}

/** El globo de una frase guardada: su imagen tal cual se levantó de la página. */
async function balloonThumb(source: ArchiveSource, director: Director, page: number, layer: string): Promise<string | null> {
  const found = director
    .framesOfPage(page)
    .flatMap((f) => f.layers ?? [])
    .find((l) => l.id === layer);
  if (!found?.src) return null;
  const bitmap = await source.bitmapOf(found.src);
  return crop(bitmap, { x: 0, y: 0, w: bitmap.width, h: bitmap.height }, "image/png");
}

function crop(bitmap: ImageBitmap, rect: Rect, type = "image/jpeg"): string | null {
  const x = Math.max(0, Math.round(rect.x));
  const y = Math.max(0, Math.round(rect.y));
  const w = Math.min(bitmap.width - x, Math.round(rect.w));
  const h = Math.min(bitmap.height - y, Math.round(rect.h));
  if (w <= 0 || h <= 0) return null;
  const k = Math.min(1, THUMB / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  canvas.getContext("2d")!.drawImage(bitmap, x, y, w, h, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(type, 0.82);
}

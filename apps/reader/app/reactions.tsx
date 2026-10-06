"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "../lib/i18n";
import { REACTIONS, react, reactionOf, type Reaction } from "../lib/reactions";

/** Chispas que despide la reacción al elegirla. */
const SPARKS = 12;
/** Lo que dura la explosión, en milisegundos (igual que la animación de globals.css). */
const BURST_MS = 1300;

type Burst = { id: number; r: Reaction; sparks: { dx: number; dy: number; rot: number; size: number; delay: number }[] };

/**
 * Reaccionar a la viñeta que se está leyendo. Un botón al costado, que aparece con los
 * controles; al elegir, el emoji explota en el medio de la pantalla. Lo elegido queda
 * guardado en este navegador, y al volver a esa viñeta se ve en la esquina.
 */
export function Reactions({
  visible,
  book,
  page,
  frame,
  onActivity,
  onHold,
}: {
  visible: boolean;
  book: string;
  page: number;
  frame: string;
  onActivity: () => void;
  onHold: (held: boolean) => void;
}) {
  const { t } = useI18n();
  const T = t.reactions;
  const [current, setCurrent] = useState<Reaction | null>(null);
  const [open, setOpen] = useState(false);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const seq = useRef(0);

  // Lo guardado para esta viñeta, cada vez que se llega a otra.
  useEffect(() => {
    setCurrent(reactionOf(book, page, frame));
  }, [book, page, frame]);

  // Con los controles escondidos, el selector también se cierra.
  useEffect(() => {
    if (!visible && open) {
      setOpen(false);
      onHold(false);
    }
  }, [visible, open, onHold]);

  const toggle = () => {
    onActivity();
    setOpen(!open);
    onHold(!open);
  };

  const choose = (r: Reaction) => {
    const next = current === r ? null : r;
    react(book, page, frame, next);
    setCurrent(next);
    setOpen(false);
    onHold(false);
    if (!next) return;
    navigator.vibrate?.(12);
    const id = ++seq.current;
    const sparks = Array.from({ length: SPARKS }, (_, i) => {
      // Alrededor del centro, más hacia arriba: suben como burbujas.
      const angle = (i / SPARKS) * Math.PI * 2 + Math.random() * 0.5;
      const reach = 90 + Math.random() * 90;
      return {
        dx: Math.cos(angle) * reach,
        dy: Math.sin(angle) * reach * 0.8 - 60 - Math.random() * 60,
        rot: (Math.random() - 0.5) * 70,
        size: 0.45 + Math.random() * 0.45,
        delay: Math.random() * 120,
      };
    });
    setBursts((b) => [...b, { id, r: next, sparks }]);
    window.setTimeout(() => setBursts((b) => b.filter((x) => x.id !== id)), BURST_MS + 200);
  };

  return (
    <>
      {/* La explosión, en el medio de la pantalla y sin tapar los toques. */}
      {bursts.map((b) => (
        <div key={b.id} aria-hidden className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
          <span className="emoji react-pop absolute text-[96px] leading-none drop-shadow-[0_6px_18px_rgba(0,0,0,0.45)]">
            {b.r}
          </span>
          {b.sparks.map((s, i) => (
            <span
              key={i}
              className="emoji react-spark absolute leading-none"
              style={
                {
                  fontSize: `${Math.round(48 * s.size)}px`,
                  "--dx": `${s.dx}px`,
                  "--dy": `${s.dy}px`,
                  "--rot": `${s.rot}deg`,
                  animationDelay: `${s.delay}ms`,
                } as React.CSSProperties
              }
            >
              {b.r}
            </span>
          ))}
        </div>
      ))}

      {/* Con los controles escondidos, la reacción de esta viñeta queda chiquita en la esquina. */}
      {current && !visible && (
        <span
          key={`${page}:${frame}`}
          aria-label={T.yours(current)}
          className="emoji react-chip pointer-events-none absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-30 flex size-10 items-center justify-center rounded-full bg-black/45 text-xl backdrop-blur"
        >
          {current}
        </span>
      )}

      <div
        inert={!visible}
        onPointerDownCapture={onActivity}
        // Los toques acá no son gestos de lectura: sin esto, tocar el botón también pasaba de viñeta.
        onPointerDown={(e) => e.stopPropagation()}
        className={`absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-30 flex flex-col items-center gap-2 transition-opacity duration-300 ${
          visible ? "" : "pointer-events-none opacity-0"
        }`}
      >
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          title={current ? T.change : T.react}
          aria-label={current ? T.change : T.react}
          className={`emoji flex size-10 touch-manipulation items-center justify-center rounded-full border border-neutral-700/80 bg-neutral-900/85 text-xl text-neutral-200 backdrop-blur transition-transform hover:bg-neutral-800 active:scale-90 ${
            open ? "ring-2 ring-neutral-100/70" : ""
          }`}
        >
          {current ?? (
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <circle cx="11" cy="13" r="8" />
              <path d="M8 15.5c1.6 1.6 4.4 1.6 6 0" strokeLinecap="round" />
              <circle cx="8.5" cy="11" r="0.9" fill="currentColor" stroke="none" />
              <circle cx="13.5" cy="11" r="0.9" fill="currentColor" stroke="none" />
              <path d="M20 2v5M17.5 4.5h5" strokeLinecap="round" />
            </svg>
          )}
        </button>
        {open && (
          <div
            role="group"
            aria-label={T.pick}
            className="flex flex-col items-center gap-0.5 rounded-full border border-neutral-700/80 bg-neutral-900/85 px-0.5 py-1.5 backdrop-blur"
          >
            {REACTIONS.map((r, i) => (
              <button
                key={r}
                type="button"
                onClick={() => choose(r)}
                aria-pressed={current === r}
                title={T.name[r]}
                aria-label={T.name[r]}
                style={{ animationDelay: `${i * 35}ms` }}
                className={`emoji react-option flex h-10 w-10 touch-manipulation items-center justify-center rounded-full text-2xl transition-transform hover:scale-125 active:scale-90 ${
                  current === r ? "bg-neutral-100/20" : ""
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

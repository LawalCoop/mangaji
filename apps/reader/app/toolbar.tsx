"use client";

import { MOOD_ORDER, MOODS, type MoodId } from "@/lib/mood";

/**
 * Controles del lector. Se muestran sobre la página y se apagan solos mientras se lee, para
 * no competir con el manga.
 */
export type ToolbarProps = {
  title: string;
  page: number;
  pages: number;
  panel: number;
  panels: number;
  /** 0..1 */
  progress: number;
  mood: MoodId;
  music: boolean;
  /** 0..1 */
  volume: number;
  onVolume: (value: number) => void;
  panelMode: boolean;
  hasPanels: boolean;
  /** Páginas ya procesadas mientras se lee, o null si no hay nada en curso. */
  built: { done: number; total: number } | null;
  /** Cuánto falta para tener el tomo entero. */
  eta: string | null;
  /** El tomo está entero: se puede guardar para no volver a procesarlo. */
  canSave: boolean;
  onSave: () => void;
  onPage: (page: number) => void;
  onStep: (delta: number) => void;
  onZoom: (factor: number) => void;
  onFit: () => void;
  onMood: (mood: MoodId) => void;
  onMusic: (on: boolean) => void;
  onToggleMode: () => void;
};

export function Toolbar(props: ToolbarProps) {
  const { page, pages, panel, panels, progress } = props;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col gap-2 bg-gradient-to-t from-black/80 via-black/50 to-transparent px-4 pb-3 pt-10 text-neutral-200">
      {/* Progreso de lectura del capítulo entero, no de la página. */}
      <div className="pointer-events-auto flex items-center gap-3">
        <span className="w-11 shrink-0 text-right text-[11px] tabular-nums text-neutral-400">
          {Math.round(progress * 100)}%
        </span>
        <input
          type="range"
          min={1}
          max={Math.max(pages, 1)}
          value={page}
          onChange={(e) => props.onPage(Number(e.target.value))}
          aria-label="Ir a una página"
          className="h-1 w-full cursor-pointer appearance-none rounded-full bg-neutral-700 accent-neutral-100 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-neutral-100"
        />
        <span className="w-24 shrink-0 text-[11px] tabular-nums text-neutral-400">
          {page} / {pages}
        </span>
      </div>

      <div className="pointer-events-auto flex flex-wrap items-center gap-2 text-xs">
        <Group>
          <Button onClick={() => props.onPage(page - 1)} disabled={page <= 1} title="Página anterior (↑)">
            ‹‹
          </Button>
          <Button onClick={() => props.onStep(-1)} title="Viñeta anterior (→)">
            ‹
          </Button>
          <Button onClick={() => props.onStep(1)} title="Viñeta siguiente (← o espacio)">
            ›
          </Button>
          <Button onClick={() => props.onPage(page + 1)} disabled={page >= pages} title="Página siguiente (↓)">
            ››
          </Button>
        </Group>

        <Group>
          <Button onClick={() => props.onZoom(1 / 1.25)} title="Alejar (−)">
            −
          </Button>
          <Button onClick={props.onFit} title="Encuadrar (f)">
            ⤢
          </Button>
          <Button onClick={() => props.onZoom(1.25)} title="Acercar (+)">
            +
          </Button>
        </Group>

        {props.hasPanels && (
          <Group>
            <Button onClick={props.onToggleMode} title="Alternar viñeta / página (v)">
              {props.panelMode ? "viñeta" : "página"}
            </Button>
          </Group>
        )}

        <Group>
          {MOOD_ORDER.map((id) => (
            <Button
              key={id}
              onClick={() => props.onMood(id)}
              active={props.mood === id}
              title={`Intensidad: ${MOODS[id].label}`}
            >
              {MOODS[id].label}
            </Button>
          ))}
        </Group>

        <Group>
          <Button onClick={() => props.onMusic(!props.music)} active={props.music} title="Música (m)">
            {props.music ? "♪ on" : "♪ off"}
          </Button>
          {/* El volumen solo tiene sentido con la música puesta. */}
          {props.music && (
            <label className="flex items-center gap-2 px-2.5 py-1.5" title="Volumen">
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(props.volume * 100)}
                onChange={(e) => props.onVolume(Number(e.target.value) / 100)}
                aria-label="Volumen de la música"
                className="h-1 w-20 cursor-pointer appearance-none rounded-full bg-neutral-700 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-neutral-100"
              />
              <span className="w-7 text-right text-[10px] tabular-nums text-neutral-500">
                {Math.round(props.volume * 100)}
              </span>
            </label>
          )}
        </Group>

        {/* El tomo se sigue procesando detrás mientras se lee: conviene que se vea, sobre
            todo para entender por qué el final todavía no está. */}
        {props.built && (
          <span
            className="flex items-center gap-2 rounded-md border border-neutral-700/80 bg-neutral-900/70 px-2.5 py-1.5 text-[11px] text-neutral-400 backdrop-blur"
            title="Las páginas que faltan se están procesando mientras leés"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#00D9F5]" />
            <span className="tabular-nums">
              procesando {props.built.done} / {props.built.total}
              {props.eta && <span className="ml-1 text-neutral-500">· queda {props.eta}</span>}
            </span>
          </span>
        )}

        {props.canSave && (
          <Group>
            <Button onClick={props.onSave} title="Guardar el tomo ya procesado para abrirlo al instante">
              guardar .cbza
            </Button>
          </Group>
        )}

        <span className="ml-auto truncate text-[11px] text-neutral-500">
          {props.title}
          {props.panelMode && panels > 0 && (
            <span className="ml-2 tabular-nums">
              viñeta {panel} / {panels}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-px overflow-hidden rounded-md border border-neutral-700/80 bg-neutral-900/70 backdrop-blur">
      {children}
    </div>
  );
}

function Button({
  children,
  onClick,
  disabled,
  active,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`min-w-8 px-2.5 py-1.5 text-xs transition-colors disabled:opacity-30 ${
        active ? "bg-neutral-100 text-neutral-900" : "hover:bg-neutral-800"
      }`}
    >
      {children}
    </button>
  );
}

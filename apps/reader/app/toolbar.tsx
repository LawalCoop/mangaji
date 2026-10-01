"use client";

import { useState } from "react";
import { etaText, useI18n } from "@/lib/i18n";
import { MOOD_ORDER, type MoodId } from "@/lib/mood";

/**
 * Controles del lector. Se muestran sobre la página y se apagan solos mientras se lee, para
 * no competir con el manga.
 */
export type ToolbarProps = {
  /** Los controles están a la vista; escondidos no reciben toques ni foco. */
  visible: boolean;
  /** Se tocó algo de la barra: que no se esconda en medio del uso. */
  onActivity: () => void;
  /** Hay un panel abierto y la barra tiene que quedarse mientras tanto. */
  onHold: (held: boolean) => void;
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
  /** Segundos que faltan para tener el tomo entero. */
  eta: number | null;
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
  /** Cámara experimental, que sigue la tensión de cada escena. */
  directed: boolean;
  onToggleDirected: () => void;
};

/** Pista de un control deslizante, con el pulgar grande cuando se usa con el dedo. */
const RANGE =
  "cursor-pointer appearance-none rounded-full bg-neutral-700 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-neutral-100 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-neutral-100";

export function Toolbar(props: ToolbarProps) {
  const { page, pages, panel, panels, progress, visible } = props;
  const { t } = useI18n();
  const T = t.toolbar;
  // En el celular lo secundario vive en un panel aparte: en una sola fila no entra, y en
  // tres filas la barra tapaba la viñeta.
  const [more, setMore] = useState(false);
  const toggleMore = () => {
    setMore(!more);
    props.onHold(!more);
  };

  /** Zoom, intensidad, música, progreso del procesamiento y guardado. */
  const secondary = (
    <>
      <Group>
        <Button onClick={() => props.onZoom(1 / 1.25)} title={T.zoomOut}>
          −
        </Button>
        <Button onClick={props.onFit} title={T.fit}>
          ⤢
        </Button>
        <Button onClick={() => props.onZoom(1.25)} title={T.zoomIn}>
          +
        </Button>
      </Group>

      <Group>
        {MOOD_ORDER.map((id) => (
          <Button
            key={id}
            onClick={() => props.onMood(id)}
            active={props.mood === id}
            title={T.intensity(t.moods[id])}
          >
            {t.moods[id]}
          </Button>
        ))}
      </Group>

      <Group>
        <Button onClick={() => props.onMusic(!props.music)} active={props.music} title={T.music}>
          {props.music ? T.musicOn : T.musicOff}
        </Button>
        {/* El volumen solo tiene sentido con la música puesta. */}
        {props.music && (
          <label className="flex items-center gap-2 px-2.5 py-1.5" title={T.volume}>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(props.volume * 100)}
              onChange={(e) => props.onVolume(Number(e.target.value) / 100)}
              aria-label={T.volumeLabel}
              className={`${RANGE} h-1 w-20 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-2.5 pointer-coarse:w-28 pointer-coarse:[&::-webkit-slider-thumb]:h-5 pointer-coarse:[&::-webkit-slider-thumb]:w-5 pointer-coarse:[&::-moz-range-thumb]:h-5 pointer-coarse:[&::-moz-range-thumb]:w-5`}
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
          title={T.buildingTitle}
        >
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#00D9F5]" />
          <span className="tabular-nums">
            {T.building(props.built.done, props.built.total)}
            {props.eta !== null && (
              <span className="ml-1 text-neutral-500">{T.remaining(etaText(t, props.eta))}</span>
            )}
          </span>
        </span>
      )}

      {props.canSave && (
        <Group>
          <Button onClick={props.onSave} title={T.saveTitle}>
            {T.save}
          </Button>
        </Group>
      )}
    </>
  );

  return (
    <div
      inert={!visible}
      onPointerDownCapture={props.onActivity}
      className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col gap-2 bg-gradient-to-t from-black/85 via-black/55 to-transparent pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-10 text-neutral-200 transition-[opacity,translate] duration-300 ${
        visible ? "" : "translate-y-3 opacity-0"
      }`}
    >
      {more && (
        <div className="pointer-events-auto flex flex-wrap items-center gap-2 text-xs md:hidden">
          {secondary}
        </div>
      )}

      {/* Progreso de lectura del capítulo entero, no de la página. */}
      <div className="pointer-events-auto flex items-center gap-3">
        <span className="w-11 shrink-0 text-right text-[11px] tabular-nums text-neutral-400 max-sm:hidden">
          {Math.round(progress * 100)}%
        </span>
        {/* La barra también corre de derecha a izquierda: el principio del tomo a la derecha. */}
        <input
          type="range"
          dir="rtl"
          min={1}
          max={Math.max(pages, 1)}
          value={page}
          onChange={(e) => props.onPage(Number(e.target.value))}
          aria-label={T.goToPage}
          className={`${RANGE} h-1 w-full accent-neutral-100 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 pointer-coarse:h-1.5 pointer-coarse:[&::-webkit-slider-thumb]:h-5 pointer-coarse:[&::-webkit-slider-thumb]:w-5 pointer-coarse:[&::-moz-range-thumb]:h-5 pointer-coarse:[&::-moz-range-thumb]:w-5`}
        />
        <span className="shrink-0 text-[11px] tabular-nums text-neutral-400 sm:w-24">
          {page} / {pages}
        </span>
      </div>

      <div className="pointer-events-auto flex flex-wrap items-center gap-2 text-xs">
        {/* De derecha a izquierda, como se lee el manga y como las flechas del teclado:
            lo que apunta a la izquierda avanza. */}
        <Group>
          <Button onClick={() => props.onPage(page + 1)} disabled={page >= pages} title={T.nextPage}>
            ‹‹
          </Button>
          <Button onClick={() => props.onStep(1)} title={T.nextPanel}>
            ‹
          </Button>
          <Button onClick={() => props.onStep(-1)} title={T.prevPanel}>
            ›
          </Button>
          <Button onClick={() => props.onPage(page - 1)} disabled={page <= 1} title={T.prevPage}>
            ››
          </Button>
        </Group>

        {props.hasPanels && (
          <Group>
            <Button onClick={props.onToggleMode} title={T.toggleMode}>
              {props.panelMode ? T.modePanel : T.modePage}
            </Button>
            <Button onClick={props.onToggleDirected} active={props.directed} title={T.directedTitle}>
              {T.directed}
            </Button>
          </Group>
        )}

        <div className="contents max-md:hidden">{secondary}</div>

        <Group className="md:hidden">
          <Button onClick={toggleMore} active={more} title={T.more}>
            <span className="relative">
              ⋯
              {/* Se sigue procesando: que se note aunque el panel esté cerrado. */}
              {props.built && !more && (
                <span className="absolute -right-2 -top-1 h-1.5 w-1.5 animate-pulse rounded-full bg-[#00D9F5]" />
              )}
            </span>
          </Button>
        </Group>

        <span className="ml-auto truncate text-[11px] text-neutral-500">
          <span className="max-sm:hidden">{props.title}</span>
          {props.panelMode && panels > 0 && (
            <span className="ml-2 tabular-nums">
              {T.panelOf(panel, panels)}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

function Group({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`flex items-center gap-px overflow-hidden rounded-md border border-neutral-700/80 bg-neutral-900/70 backdrop-blur ${className}`}
    >
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
      className={`min-w-8 touch-manipulation px-2.5 py-1.5 text-xs transition-colors disabled:opacity-30 pointer-coarse:min-h-10 pointer-coarse:min-w-10 pointer-coarse:text-sm ${
        active ? "bg-neutral-100 text-neutral-900" : "hover:bg-neutral-800"
      }`}
    >
      {children}
    </button>
  );
}

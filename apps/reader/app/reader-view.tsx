"use client";

import { MANIFEST_FILENAME, safeParseManifest, type CameraMove } from "@mangaji/format";
import { useCallback, useEffect, useRef, useState } from "react";
import { CbzSource } from "@/lib/archive";
import { Camera, type Viewport } from "@/lib/camera";
import { Director } from "@/lib/director";
import { PageFrameSource, PanelFrameSource } from "@/lib/frame-sources";
import { DEFAULT_MOOD, MOOD_ORDER, MOODS, type MoodId } from "@/lib/mood";
import { Music } from "@/lib/music";
import { Stage } from "@/lib/stage";
import type { Rect } from "@/lib/types";
import { Landing } from "./landing";
import { Toolbar } from "./toolbar";

/** Hasta que la página se decodifica no se sabe su tamaño; esto evita un encuadre en cero. */
const ASSUMED_PAGE = { w: 1600, h: 2300 };
/** Aire alrededor del encuadre: pegar la viñeta al borde se siente asfixiante. */
const FIT_MARGIN = 0.94;
/** Duración del viaje de la cámara entre viñetas de la misma página. */
const TRAVEL_MS = 520;

// La cámara se detiene al llegar a la viñeta. Se probó dejarla derivando muy despacio para
// que la toma no quedara del todo quieta, y en marcha distrae más de lo que aporta: el
// movimiento lo dan la entrada y el viaje entre viñetas, y entre medio conviene leer tranquilo.

// Cuánto se destaca la viñeta activa lo fija ahora el mood, en `lib/mood.ts`.

/** Traduce un movimiento de cámara del manifest a un par de encuadres concretos. */
function framing(cam: CameraMove | undefined, rect: Rect, view: Viewport) {
  const at = (zoom: number) => Camera.fit(rect, view, FIT_MARGIN * zoom);
  switch (cam?.kind) {
    case "punchIn":
    case "pullBack":
      return { from: at(cam.from), to: at(cam.to) };
    case "kenBurns":
      return { from: at(1), to: at(cam.zoom) };
    default:
      return { from: at(1), to: at(1) };
  }
}

type Status = { kind: "idle" } | { kind: "loading" } | { kind: "ready" } | { kind: "error"; message: string };

export default function ReaderView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engine = useRef<{
    source: CbzSource;
    stage: Stage;
    director: Director;
    sizes: { w: number; h: number }[];
    pageFrames: PageFrameSource;
    panelFrames: PanelFrameSource | null;
    dispose: () => void;
  } | null>(null);

  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [title, setTitle] = useState("");
  const [panelMode, setPanelMode] = useState(false);
  const [mood, setMood] = useState<MoodId>(DEFAULT_MOOD);
  const [music, setMusic] = useState(false);
  const [volume, setVolume] = useState(0.42);
  /** Posición de lectura, refrescada en cada encuadre. */
  const [at, setAt] = useState({ page: 1, pages: 1, panel: 0, panels: 0, progress: 0 });

  /** El mood se lee dentro del ciclo de render, que no ve el estado de React. */
  const moodRef = useRef(MOODS[DEFAULT_MOOD]);
  const musicRef = useRef<Music | null>(null);
  /** El volumen elegido sobrevive a apagar y volver a encender la música. */
  const volumeRef = useRef(0.42);

  const teardown = useCallback(() => {
    engine.current?.dispose();
    engine.current = null;
  }, []);

  useEffect(() => teardown, [teardown]);

  const open = useCallback(
    async (file: File) => {
      teardown();
      setStatus({ kind: "loading" });
      setTitle(file.name);

      try {
        const canvas = canvasRef.current;
        if (!canvas) throw new Error("Canvas no disponible");

        const source = await CbzSource.open(file);
        const sizes = Array.from({ length: source.pageCount }, () => ({ ...ASSUMED_PAGE }));
        const pageFrames = new PageFrameSource(sizes);

        // Un `.cbza` trae manifest y se lee viñeta por viñeta; un CBZ común, página a página.
        let panelFrames: PanelFrameSource | null = null;
        if (source.has(MANIFEST_FILENAME)) {
          const parsed = safeParseManifest(JSON.parse(await source.text(MANIFEST_FILENAME)));
          if (parsed.success) {
            panelFrames = new PanelFrameSource(parsed.data);
            parsed.data.pages.forEach((page, i) => {
              sizes[i] = { w: page.size[0], h: page.size[1] };
            });
          } else {
            console.warn("manifest inválido, se lee como CBZ común", parsed.error.issues);
          }
        }
        setPanelMode(panelFrames !== null);

        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const director = new Director(panelFrames ?? pageFrames, { reducedMotion });
        const stage = await Stage.create(canvas);

        // Cada cambio de encuadre pide su página; `token` descarta las respuestas que
        // llegan tarde cuando el lector ya avanzó.
        let token = 0;
        let shownPage = -1;
        /** Apariciones de diálogo en curso, avanzadas por el ticker. */
        const revealing = new Map<string, { elapsed: number; ms: number }>();
        /**
         * Diálogo ya revelado en esta página. Un globo apoyado sobre el borde pertenece a
         * las dos viñetas que liga, y al pasar a la vecina tiene que seguir ahí en vez de
         * volver a aparecer.
         */
        const revealed = new Set<string>();
        const draw = async (immediate: boolean) => {
          const mine = ++token;
          const frame = director.frame;
          const pos = director.positionInPage;
          setAt({
            page: frame.page + 1,
            pages: source.pageCount,
            panel: pos.index,
            panels: pos.total,
            progress: director.length > 1 ? director.index / (director.length - 1) : 1,
          });

          source.prefetch(frame.page + 1);
          source.prefetch(frame.page + 2);
          // También el diálogo que viene: si llega recién al cambiar de página, la
          // transición se queda esperando a decodificarlo.
          for (let ahead = 1; ahead <= 8; ahead++) {
            for (const layer of director.peek(ahead)?.layers ?? []) {
              if (layer.src) void source.bitmapOf(layer.src).catch(() => {});
            }
          }

          try {
            // Todo lo que haga falta se pide ANTES de tocar la escena. Si la imagen se
            // cambiara y después se esperara a los sprites, el ticker seguiría dibujando
            // durante esa espera: se vería la página nueva con el encuadre de la anterior,
            // que es un parpadeo en cada cambio de página.
            // El diálogo se carga por página entera, no por viñeta: lo que ya se leyó
            // tiene que seguir en su globo cuando la cámara viaja a la viñeta siguiente.
            // Un globo apoyado sobre el borde figura en las dos viñetas que liga.
            const pageLayers = [
              ...new Map(
                director
                  .framesOfPage(frame.page)
                  .flatMap((f) => f.layers ?? [])
                  .filter((l) => l.src)
                  .map((l) => [l.id, l] as const),
              ).values(),
            ];

            const [bitmap, dialogue] = await Promise.all([
              source.bitmap(frame.page),
              Promise.all(
                pageLayers.map(async (layer) => ({
                  id: layer.id,
                  rect: layer.rect,
                  bitmap: await source.bitmapOf(layer.src),
                })),
              ),
            ]);
            if (mine !== token) return;

            sizes[frame.page] = { w: bitmap.width, h: bitmap.height };
            const fresh = director.frame;
            const samePage = fresh.page === shownPage;
            shownPage = fresh.page;

            // A partir de acá, sin esperas: imagen, diálogo y cámara en el mismo cuadro.
            stage.show(fresh, bitmap);

            revealing.clear();
            if (!samePage) {
              // Los sprites se rehacen solo al cambiar de hoja; dentro de la misma página
              // se dejan como están, y así el diálogo ya leído conserva su lugar.
              revealed.clear();
              stage.setDialogue(dialogue);
            }
            for (const id of revealed) stage.revealDialogue(id, 1);

            // El encuadre puede salirse de la hoja sin problema: el fondo toma el tono del
            // papel, así que se lee como si la página continuara.
            const cam = fresh.beats[0]?.cam;
            const { from, to } = framing(cam, fresh.rect, stage.viewport);

            if (immediate || director.reducedMotion) {
              stage.camera.cut(to);
            } else if (samePage) {
              // Dentro de la página la cámara viaja: es lo que da la sensación de estar
              // recorriendo la hoja en vez de ver recortes sueltos.
              stage.camera.glide(to, TRAVEL_MS * moodRef.current.pace);
            } else {
              // Página nueva: se entra con el movimiento que pida el beat.
              stage.camera.cut(from);
              stage.camera.glide(to, Math.max(fresh.beats[0]?.ms ?? 0, 260));
            }
            stage.render();
          } catch (err) {
            if (mine === token) setStatus({ kind: "error", message: (err as Error).message });
          }
        };

        // La cámara la resuelve `draw`, que es quien sabe si cambió de página. Los beats
        // se ocupan del diálogo, y en v5 de los efectos.
        const offDirector = director.on((ev) => {
          if (ev.type === "frame") {
            void draw(ev.immediate);
            return;
          }
          if (ev.type !== "beat") return;

          if (ev.beat.reveal) {
            const id = ev.beat.reveal;
            if (director.reducedMotion || revealed.has(id)) stage.revealDialogue(id, 1);
            else revealing.set(id, { elapsed: 0, ms: Math.max(ev.beat.ms, 1) });
            revealed.add(id);
          }

          // Con movimiento reducido no se dispara ninguno: son todos movimiento.
          if (ev.beat.fx && !director.reducedMotion && moodRef.current.fx > 0) {
            const fx = ev.beat.fx;
            const power =
              fx.kind === "shake"
                ? fx.amp
                : fx.kind === "flash"
                  ? fx.strength
                  : fx.kind === "speedlines"
                    ? fx.density
                    : 0;
            // El mood decide con cuánta fuerza se ejecuta lo que el manifest pide.
            stage.playFx(fx.kind, power * moodRef.current.fx, Math.max(ev.beat.ms, 120));
            musicRef.current?.accent(0.8);
          }
        });

        const offTick = stage.onTick((dt) => {
          // El ritmo del mood se aplica al reloj del director: así escala todo de una vez
          // —pausas, tiempos de lectura, apariciones— en vez de retocar cada duración.
          director.tick(dt / moodRef.current.pace);
          stage.camera.update(dt);
          stage.updateFx(dt);

          for (const [id, anim] of revealing) {
            anim.elapsed += dt;
            const t = Math.min(anim.elapsed / anim.ms, 1);
            // Suavizado de salida: entra rápido y se asienta, que se lee mejor que lineal.
            stage.revealDialogue(id, 1 - (1 - t) * (1 - t));
            if (t >= 1) revealing.delete(id);
          }

          stage.render();
        });

        const onResize = () => {
          const frame = director.frame;
          const { to } = framing(frame.beats[0]?.cam, frame.rect, stage.viewport);
          stage.camera.cut(to);
          stage.render();
        };
        window.addEventListener("resize", onResize);

        stage.focusStrength = moodRef.current.focus.shade;
        stage.focusBlur = moodRef.current.focus.blur;

        engine.current = {
          source,
          stage,
          director,
          sizes,
          pageFrames,
          panelFrames,
          dispose: () => {
            window.removeEventListener("resize", onResize);
            offTick();
            offDirector();
            stage.destroy();
            source.close();
          },
        };

        setStatus({ kind: "ready" });
        void draw(true);
      } catch (err) {
        setStatus({ kind: "error", message: (err as Error).message });
      }
    },
    [teardown],
  );

  /** Aplica el mood a lo que ya está andando. */
  const applyMood = useCallback((id: MoodId) => {
    const next = MOODS[id];
    moodRef.current = next;
    setMood(id);
    void musicRef.current?.setMood(next);

    const eng = engine.current;
    if (!eng) return;
    eng.stage.focusStrength = next.focus.shade;
    eng.stage.focusBlur = next.focus.blur;
    eng.stage.refocus(eng.director.frame);
    eng.stage.render();
  }, []);

  const toggleMusic = useCallback((on: boolean) => {
    if (!on) {
      musicRef.current?.stop();
      musicRef.current = null;
      setMusic(false);
      return;
    }
    // Debe arrancar desde un gesto del usuario: el navegador no deja sonar audio sin eso.
    const player = new Music(moodRef.current, volumeRef.current);
    musicRef.current = player;
    void player.start().then(
      () => setMusic(true),
      () => {
        musicRef.current = null;
        setMusic(false);
      },
    );
  }, []);

  const changeVolume = useCallback((value: number) => {
    volumeRef.current = value;
    setVolume(value);
    musicRef.current?.setVolume(value);
  }, []);

  useEffect(() => () => musicRef.current?.stop(), []);

  const zoom = useCallback((factor: number) => {
    const eng = engine.current;
    if (!eng) return;
    const { w, h } = eng.stage.viewport;
    eng.stage.camera.zoomAt(factor, w / 2, h / 2);
    eng.stage.render();
  }, []);

  const fit = useCallback(() => {
    const eng = engine.current;
    if (!eng) return;
    eng.stage.camera.cut(
      Camera.fit(eng.director.frame.rect, eng.stage.viewport, FIT_MARGIN),
    );
    eng.stage.render();
  }, []);

  const toggleMode = useCallback(() => {
    const eng = engine.current;
    if (!eng?.panelFrames) return;
    const toPanels = eng.director.length === eng.pageFrames.length;
    eng.director.setSource(toPanels ? eng.panelFrames : eng.pageFrames);
    setPanelMode(toPanels);
  }, []);

  // Teclado. Manga se lee derecha→izquierda: la flecha izquierda avanza.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const eng = engine.current;
      if (!eng) return;
      switch (e.key) {
        case "ArrowLeft":
        case " ":
        case "PageDown":
          e.preventDefault();
          eng.director.next();
          break;
        case "ArrowRight":
        case "PageUp":
          e.preventDefault();
          eng.director.prev();
          break;
        case "ArrowDown":
          e.preventDefault();
          eng.director.seekToPage(eng.director.frame.page + 1);
          break;
        case "ArrowUp":
          e.preventDefault();
          eng.director.seekToPage(eng.director.frame.page - 1);
          break;
        case "f":
          fit();
          break;
        case "+":
        case "=":
          zoom(1.25);
          break;
        case "-":
          zoom(1 / 1.25);
          break;
        case "m":
          toggleMusic(!musicRef.current);
          break;
        case "v":
          toggleMode();
          break;
        case "1":
        case "2":
        case "3":
        case "4":
          applyMood(MOOD_ORDER[Number(e.key) - 1]);
          break;
        case "Home":
          eng.director.seek(0);
          break;
        case "End":
          eng.director.seek(eng.director.length - 1);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applyMood, fit, toggleMode, toggleMusic, zoom]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files?.[0];
      if (file) void open(file);
    },
    [open],
  );

  // Paneo con arrastre; un click limpio avanza o retrocede según la mitad de pantalla.
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!engine.current) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const eng = engine.current;
    if (!d || !eng) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    eng.stage.camera.nudge(dx, dy);
    d.x = e.clientX;
    d.y = e.clientY;
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    const eng = engine.current;
    drag.current = null;
    if (!d || !eng || d.moved) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // Mitad izquierda = siguiente, por la dirección de lectura del manga.
    e.clientX - rect.left < rect.width / 2 ? eng.director.next() : eng.director.prev();
  };

  const onWheel = (e: React.WheelEvent) => {
    const eng = engine.current;
    if (!eng) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    eng.stage.camera.zoomAt(
      e.deltaY < 0 ? 1.12 : 1 / 1.12,
      e.clientX - rect.left,
      e.clientY - rect.top,
    );
  };

  return (
    <main
      className="relative h-dvh w-dvw overflow-hidden bg-neutral-950 text-neutral-200"
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <div
        className="absolute inset-0 touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        onWheel={onWheel}
      >
        <canvas ref={canvasRef} className="block h-full w-full" />
      </div>

      {status.kind !== "ready" && (
        <div className="absolute inset-0 overflow-y-auto">
          <Landing
            status={status.kind === "error" ? "error" : status.kind === "loading" ? "loading" : "idle"}
            message={status.kind === "error" ? status.message : undefined}
            onFile={(file) => void open(file)}
          />
        </div>
      )}

      {status.kind === "ready" && (
        <Toolbar
          title={title}
          page={at.page}
          pages={at.pages}
          panel={at.panel}
          panels={at.panels}
          progress={at.progress}
          mood={mood}
          music={music}
          volume={volume}
          onVolume={changeVolume}
          panelMode={panelMode}
          hasPanels={Boolean(engine.current?.panelFrames)}
          onPage={(page) => engine.current?.director.seekToPage(page - 1)}
          onStep={(delta) =>
            delta > 0 ? engine.current?.director.next() : engine.current?.director.prev()
          }
          onZoom={zoom}
          onFit={fit}
          onMood={applyMood}
          onMusic={toggleMusic}
          onToggleMode={toggleMode}
        />
      )}
    </main>
  );
}

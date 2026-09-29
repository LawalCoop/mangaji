"use client";

import { MANIFEST_FILENAME, Page, safeParseManifest, type CameraMove } from "@mangaji/format";
import { useCallback, useEffect, useRef, useState } from "react";
import { CbzSource, type ArchiveSource } from "@/lib/archive";
import { Camera, type Viewport } from "@/lib/camera";
import { Director } from "@/lib/director";
import { PageFrameSource, PanelFrameSource } from "@/lib/frame-sources";
import { LiveSource } from "@/lib/live-archive";
import { DEFAULT_MOOD, MOOD_ORDER, MOODS, type MoodId } from "@/lib/mood";
import { Music } from "@/lib/music";
import { Stage } from "@/lib/stage";
import type { Rect } from "@/lib/types";
import type { ProcessRequest, ProcessResponse } from "@/lib/process.worker";
import { Landing } from "./landing";
import { Processing, type Stage as ProcessStage } from "./processing";
import { Toolbar } from "./toolbar";

/** Hasta que la página se decodifica no se sabe su tamaño; esto evita un encuadre en cero. */
const ASSUMED_PAGE = { w: 1600, h: 2300 };
/** Aire alrededor del encuadre: pegar la viñeta al borde se siente asfixiante. */
const FIT_MARGIN = 0.94;
/** Duración del viaje de la cámara entre viñetas de la misma página. */
const TRAVEL_MS = 520;
/**
 * Apertura: la primera página no aparece, se descubre.
 *
 * La cámara arranca encima del borde superior derecho —donde empieza la lectura del manga—
 * y se abre hasta la portada completa mientras la pantalla se despeja. Es el momento en que
 * el lector tiene que entender de qué se trata, así que se toma su tiempo.
 */
const OPENING = { ms: 2600, zoom: 2.3, curtain: 1100 };

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

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "processing" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

/** Cuántas páginas mirar hacia atrás para estimar lo que falta. */
const ETA_WINDOW = 5;

function formatEta(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  const min = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest ? `${min} min ${rest} s` : `${min} min`;
}

export default function ReaderView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engine = useRef<{
    source: ArchiveSource;
    stage: Stage;
    director: Director;
    sizes: { w: number; h: number }[];
    pageFrames: PageFrameSource;
    panelFrames: PanelFrameSource | null;
    dispose: () => void;
  } | null>(null);
  /** El archivo que se está escribiendo, para poder guardarlo cuando esté completo. */
  const liveRef = useRef<LiveSource | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [title, setTitle] = useState("");
  /** Lo que se muestra mientras se espera la primera página de un CBZ. */
  const [stage, setStage] = useState<ProcessStage | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [eta, setEta] = useState<string | null>(null);
  /** Cuánto del tomo lleva procesado mientras se lee, o null si no hay nada en curso. */
  const [built, setBuilt] = useState<{ done: number; total: number } | null>(null);
  /** El tomo terminó de procesarse y se puede guardar. */
  const [archived, setArchived] = useState(false);
  /** Se leyó más rápido de lo que se procesa y hay que esperar a la página siguiente. */
  const [waiting, setWaiting] = useState(false);
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
    // Si había un tomo a medio procesar, su worker sigue vivo con los modelos cargados.
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  useEffect(() => teardown, [teardown]);

  /**
   * Monta el motor de lectura sobre una fuente.
   *
   * No le importa si el archivo está completo o todavía se está procesando: `ArchiveSource`
   * existe justamente para eso, y `PanelFrameSource` puede seguir creciendo debajo.
   */
  const mount = useCallback(
    async (
      canvas: HTMLCanvasElement,
      source: ArchiveSource,
      sizes: { w: number; h: number }[],
      pageFrames: PageFrameSource,
      panelFrames: PanelFrameSource | null,
    ) => {
      try {
        setPanelMode(panelFrames !== null);

        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const director = new Director(panelFrames ?? pageFrames, { reducedMotion });
        const stage = await Stage.create(canvas);

        // Cada cambio de encuadre pide su página; `token` descarta las respuestas que
        // llegan tarde cuando el lector ya avanzó.
        let token = 0;
        let shownPage = -1;
        /** La apertura ocurre una sola vez, al abrir el archivo. */
        let opening = true;
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
            pages: sizes.length,
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

            if (immediate && !director.reducedMotion && opening) {
              opening = false;
              // Plano cerrado sobre el ángulo por donde se empieza a leer, y desde ahí se
              // abre a la página entera.
              const close = Camera.fit(fresh.rect, stage.viewport, FIT_MARGIN * OPENING.zoom);
              stage.camera.cut({
                scale: close.scale,
                x: close.x - stage.viewport.w * 0.3,
                y: close.y + stage.viewport.h * 0.28,
              });
              stage.camera.glide(to, OPENING.ms * moodRef.current.pace);
              stage.openCurtain(OPENING.curtain);
            } else if (immediate || director.reducedMotion) {
              opening = false;
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
            setWaiting(false);
            void draw(ev.immediate);
            return;
          }
          // Se llegó al borde de lo procesado: se avisa y se sigue solo cuando aparezca la
          // página siguiente. Pasa únicamente si se lee más rápido de lo que se procesa.
          if (ev.type === "waiting") {
            setWaiting(true);
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
    [],
  );

  /**
   * Procesa un CBZ dejando leer mientras tanto.
   *
   * La lectura arranca con la primera página y el resto se procesa detrás, en un worker.
   * Se puede porque leer una viñeta dirigida lleva más tiempo que procesar la página que
   * viene, así que el lector no alcanza al procesador salvo que pase todo de largo.
   */
  const build = useCallback(
    async (canvas: HTMLCanvasElement, file: File) => {
      setStatus({ kind: "processing" });
      setStage(null);
      setLines(["descomprimiendo el archivo"]);
      setProgress(null);
      setEta(null);

      const cbz = await CbzSource.open(file);
      const total = cbz.pageCount;
      setLines((l) => [...l, `${total} páginas`]);

      const live = new LiveSource();
      liveRef.current = live;
      // Dos medidas de la misma cosa: `sizes` es el tomo entero, que se conoce de entrada y
      // da el "página 3 de 12"; `ready` solo lo procesado, que es hasta dónde se puede leer.
      const sizes = Array.from({ length: total }, () => ({ ...ASSUMED_PAGE }));
      const ready: { w: number; h: number }[] = [];
      const pageFrames = new PageFrameSource(ready);
      const panelFrames = new PanelFrameSource(undefined, total);

      const worker = new Worker(new URL("../lib/process.worker.ts", import.meta.url), {
        type: "module",
      });
      workerRef.current = worker;

      const marks: number[] = [];
      const settle = new Map<number, () => void>();
      let mounted = false;
      let failed: string | null = null;

      worker.onmessage = async (ev: MessageEvent<ProcessResponse>) => {
        const msg = ev.data;

        if (msg.kind === "models") {
          setStage({ kind: "models", detail: msg.detail });
          setLines((l) => [...l, msg.detail]);
          return;
        }

        if (msg.kind === "progress") {
          setStage({ kind: "page", index: msg.index, total, detail: msg.detail });
          setLines((l) => [...l, `página ${msg.index + 1}: ${msg.detail}`]);
          return;
        }

        if (msg.kind === "error") {
          failed = msg.message;
          settle.get(msg.index)?.();
          return;
        }

        const done = msg.page;
        live.add(done);
        sizes[done.index] = { w: done.size[0], h: done.size[1] };
        ready[done.index] = sizes[done.index];

        // El manifest se valida página por página: el streaming no afloja las garantías que
        // daba leerlo entero de un archivo terminado.
        const parsed = Page.safeParse(done.page);
        if (parsed.success) panelFrames.append(parsed.data, done.index);
        else console.warn(`página ${done.index + 1} inválida`, parsed.error.issues);

        setProgress((done.index + 1) / total);
        // La estimación se hace sobre las últimas páginas y no sobre el promedio: las
        // primeras cargan modelos y salen más lentas, y arrastran la cuenta hacia arriba.
        marks[done.index] = performance.now();
        const from = Math.max(0, done.index - ETA_WINDOW);
        if (done.index > from) {
          const per = (marks[done.index] - marks[from]) / (done.index - from);
          setEta(formatEta(((total - done.index - 1) * per) / 1000));
        }
        setBuilt({ done: done.index + 1, total });

        // Con la primera página ya hay con qué leer: se abre el lector y el resto entra
        // debajo, sin que la lectura se corte.
        if (!mounted) {
          mounted = true;
          await mount(canvas, live, sizes, pageFrames, panelFrames);
        } else {
          engine.current?.director.grew();
        }

        settle.get(done.index)?.();
      };

      try {
        for (let index = 0; index < total; index++) {
          const bitmap = await cbz.bitmap(index);
          const settled = new Promise<void>((resolve) => settle.set(index, resolve));
          // El bitmap se transfiere, no se copia; por eso se saca de la caché del archivo,
          // que si no queda apuntando a una imagen que ya no es suya.
          worker.postMessage({ kind: "page", index, bitmap } satisfies ProcessRequest, [bitmap]);
          cbz.release(index);
          await settled;
          settle.delete(index);
          if (failed) throw new Error(failed);
        }
      } finally {
        cbz.close();
        worker.postMessage({ kind: "close" } satisfies ProcessRequest);
        workerRef.current = null;
      }

      panelFrames.finish();
      setBuilt(null);
      setEta(null);
      setArchived(true);
    },
    [mount],
  );

  const open = useCallback(
    async (input: File) => {
      teardown();
      setStatus({ kind: "loading" });
      setTitle(input.name);
      setArchived(false);
      setBuilt(null);
      liveRef.current = null;

      try {
        const canvas = canvasRef.current;
        if (!canvas) throw new Error("Canvas no disponible");

        // Un CBZ hay que procesarlo, y eso se hace leyendo; un `.cbza` ya viene listo.
        if (!/\.cbza$/i.test(input.name)) {
          await build(canvas, input);
          return;
        }

        const source = await CbzSource.open(input);
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

        await mount(canvas, source, sizes, pageFrames, panelFrames);
      } catch (err) {
        setStatus({ kind: "error", message: (err as Error).message });
      }
    },
    [build, mount, teardown],
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

  /**
   * Guarda el tomo ya procesado.
   *
   * El zip se arma recién acá, cuando alguien lo pide: mantenerlo listo por las dudas sería
   * tener el tomo entero duplicado en memoria durante toda la lectura.
   */
  const save = useCallback(async () => {
    const live = liveRef.current;
    if (!live) return;

    const { packArchive } = await import("@/lib/process");
    const url = URL.createObjectURL(packArchive(live.pages));
    const link = document.createElement("a");
    link.href = url;
    link.download = title.replace(/\.[^.]+$/, "") + ".cbza";
    link.click();
    // Recién cuando la descarga arrancó: revocarlo en el acto la cancela.
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, [title]);

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

      {/* Solo aparece si la lectura alcanzó al procesamiento, que es raro: procesar una
          página lleva menos que leerla. */}
      {waiting && (
        <div className="pointer-events-none absolute inset-x-0 top-6 z-20 flex justify-center">
          <span className="flex items-center gap-2 rounded-full border border-neutral-700/80 bg-neutral-900/85 px-4 py-2 text-xs text-neutral-300 backdrop-blur">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#00D9F5]" />
            preparando la página que sigue…
          </span>
        </div>
      )}

      {status.kind === "processing" && (
        <div className="absolute inset-0 z-20 overflow-y-auto">
          <Processing title={title} stage={stage} lines={lines} progress={progress} eta={eta} />
        </div>
      )}

      {status.kind !== "ready" && status.kind !== "processing" && (
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
          built={built}
          eta={eta}
          canSave={archived}
          onSave={save}
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

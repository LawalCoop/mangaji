"use client";

import { MANIFEST_FILENAME, Page, safeParseManifest, type CameraMove } from "@mangaji/format";
import { useCallback, useEffect, useRef, useState } from "react";
import { CbzSource, type ArchiveSource } from "@/lib/archive";
import { Camera, type Viewport } from "@/lib/camera";
import { Director } from "@/lib/director";
import { PageFrameSource, PanelFrameSource } from "@/lib/frame-sources";
import { LiveSource } from "@/lib/live-archive";
import { download, resolveLink, type DownloadProgress } from "@/lib/remote";
import { problemText, useI18n } from "@/lib/i18n";
import { ProblemError, problemOf, type Problem } from "@/lib/notes";
import { DEFAULT_MOOD, MOOD_ORDER, MOODS, type MoodId } from "@/lib/mood";
import { Music } from "@/lib/music";
import { Stage } from "@/lib/stage";
import type { Rect } from "@/lib/types";
import type { ProcessRequest, ProcessResponse } from "@/lib/process.worker";
import { Landing } from "./landing";
import { Processing, type LogLine, type Stage as ProcessStage } from "./processing";
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

/**
 * Cuánto del camino hasta poder leer representa cada paso, de 0 a 1. La descarga de los
 * detectores se lleva la mayor parte: la primera vez son unos 50 MB. Si ya están en la
 * caché del navegador, ese tramo se cruza en un instante.
 */
const PREP = {
  /** Descomprimir: entre estos dos, según el tamaño del archivo. */
  unpackedMin: 0.04,
  unpackedMax: 0.25,
  downloaded: 0.7,
  panelsReady: 0.84,
  modelsReady: 0.9,
  lifting: 0.96,
};
/** Cuántos bytes de archivo suman un punto entero de progreso al tramo de descomprimir. */
const UNPACK_BYTES_PER_SHARE = 700 * 1024 * 1024;
/**
 * Hay pasos que no informan cuánto llevan —preparar un detector puede tardar varios
 * segundos—. Mientras duran, la barra se acerca sola al final del tramo, cada vez más
 * despacio y sin llegar: así no parece colgada, y tampoco promete lo que no pasó.
 */
const CREEP = { everyMs: 150, share: 0.05 };

/** Lo que se puede abrir, por extensión. */
const OPENABLE = new Set(["cbza", "cbz", "cbr", "zip", "rar"]);
/** Cuánto puede moverse un dedo y seguir contando como toque. Un pulgar nunca queda quieto. */
const TAP_SLOP = 10;
/** Ancho de cada zona lateral de toque; el centro que queda muestra los controles. */
const TAP_ZONE = 0.35;
/** Un deslizamiento tiene que ser rápido y largo, para no confundirse con mover la cámara. */
const SWIPE = { ms: 350, px: 60 };
/** Cuánto quedan los controles a la vista después del último toque. */
const CHROME_MS = 3500;
/** Marca de que ya se mostró la ayuda de gestos, para no repetirla en cada tomo. */
const HINT_KEY = "mangaji:gestures-seen";

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
  | { kind: "error"; problem: Problem };

/** Cuántas páginas mirar hacia atrás para estimar lo que falta. */
const ETA_WINDOW = 5;

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
  const [lines, setLines] = useState<LogLine[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  /** Segundos que faltan para terminar de procesar el tomo. */
  const [eta, setEta] = useState<number | null>(null);
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

  /**
   * Controles a la vista. En el celular la barra tapa buena parte de la viñeta, así que se
   * esconde sola mientras se lee y vuelve con un toque en el centro.
   */
  const [chrome, setChrome] = useState(true);
  const { t } = useI18n();
  const chromeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Hay un panel de la barra abierto: no se esconde mientras se lo usa. */
  const chromeHeld = useRef(false);
  /** Ayuda de gestos, la primera vez que se lee con el dedo. */
  const [hint, setHint] = useState(false);
  /** Descarga en curso de un tomo pedido por link. */
  const [fetching, setFetching] = useState<DownloadProgress | null>(null);
  const fetchAbort = useRef<AbortController | null>(null);

  const scheduleHide = useCallback(() => {
    if (chromeTimer.current) clearTimeout(chromeTimer.current);
    chromeTimer.current = setTimeout(() => {
      if (!chromeHeld.current) setChrome(false);
    }, CHROME_MS);
  }, []);

  /** Muestra los controles y reinicia la cuenta para esconderlos. */
  const poke = useCallback(() => {
    setChrome(true);
    scheduleHide();
  }, [scheduleHide]);

  const toggleChrome = useCallback(() => {
    setHint(false);
    setChrome((on) => {
      if (!on) scheduleHide();
      return !on;
    });
  }, [scheduleHide]);

  const holdChrome = useCallback(
    (held: boolean) => {
      chromeHeld.current = held;
      if (held) setChrome(true);
      else scheduleHide();
    },
    [scheduleHide],
  );

  useEffect(() => {
    if (status.kind !== "ready") return;
    poke();
    if (!matchMedia("(pointer: coarse)").matches) return;
    try {
      if (localStorage.getItem(HINT_KEY)) return;
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      // Sin almacenamiento (navegación privada): se muestra igual, no pasa nada por repetirla.
    }
    setHint(true);
    const t = setTimeout(() => setHint(false), 5200);
    return () => clearTimeout(t);
  }, [status.kind, poke]);

  useEffect(
    () => () => {
      if (chromeTimer.current) clearTimeout(chromeTimer.current);
    },
    [],
  );

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
            if (mine === token) setStatus({ kind: "error", problem: problemOf(err) });
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
        setStatus({ kind: "error", problem: problemOf(err) });
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
      setLines([{ note: { key: "unpacking" } }]);
      setProgress(0);
      setEta(null);

      // El porcentaje es de todo lo que falta para empezar a leer, no solo de las páginas:
      // la primera vez lo que más tarda es bajar los detectores, y con la barra quieta en
      // cero parecía colgado. Nunca retrocede, aunque los mensajes lleguen desordenados.
      let ceiling = 0;
      const advance = (value: number, until = value) => {
        ceiling = Math.max(ceiling, until);
        setProgress((p) => Math.max(p ?? 0, Math.min(1, value)));
      };
      const creep = window.setInterval(() => {
        setProgress((p) => (p === null || p >= ceiling ? p : p + (ceiling - p) * CREEP.share));
      }, CREEP.everyMs);

      // Descomprimir no informa avance —libarchive extrae el RAR entero y avisa al final—,
      // así que la barra se acerca sola al final de este tramo mientras dura. El tramo pesa
      // según el tamaño: un tomo de 150 MB tarda bastante más que un capítulo de 10.
      const unpacked = Math.min(PREP.unpackedMax, PREP.unpackedMin + file.size / UNPACK_BYTES_PER_SHARE);
      advance(0, unpacked * 0.95);
      let cbz: CbzSource;
      try {
        cbz = await CbzSource.open(file);
      } catch (err) {
        window.clearInterval(creep);
        throw err;
      }
      const total = cbz.pageCount;
      setLines((l) => [...l, { note: { key: "pageCount", n: total } }]);
      advance(unpacked);

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

        if (msg.kind === "download") {
          advance(unpacked + (PREP.downloaded - unpacked) * msg.fraction);
          return;
        }

        if (msg.kind === "models") {
          // Con el lector abierto la pantalla de carga ya no se ve: actualizarla era
          // trabajo de React por cada página, justo mientras se lee.
          if (mounted) return;
          setStage({ kind: "models", note: msg.note });
          setLines((l) => [...l, { note: msg.note }]);
          if (msg.note.key === "loadingPanels") advance(PREP.downloaded, PREP.panelsReady);
          if (msg.note.key === "loadingDialogue") advance(PREP.panelsReady, PREP.modelsReady);
          return;
        }

        if (msg.kind === "progress") {
          if (mounted) return;
          setStage({ kind: "page", index: msg.index, total, note: msg.note });
          setLines((l) => [...l, { note: msg.note, page: msg.index + 1 }]);
          if (msg.index === 0) {
            if (msg.note.key === "findingPanels") advance(PREP.modelsReady, PREP.lifting);
            else advance(PREP.lifting, 0.99);
          }
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

        advance(1);
        window.clearInterval(creep);
        // La estimación se hace sobre las últimas páginas y no sobre el promedio: las
        // primeras cargan modelos y salen más lentas, y arrastran la cuenta hacia arriba.
        marks[done.index] = performance.now();
        const from = Math.max(0, done.index - ETA_WINDOW);
        if (done.index > from) {
          const per = (marks[done.index] - marks[from]) / (done.index - from);
          setEta(((total - done.index - 1) * per) / 1000);
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
          // Mientras dura la apertura no se procesa: la inferencia compite con la animación
          // por la placa de video —o por todos los núcleos, sin GPU— y la tapa entraba a
          // tirones. Después sigue, con la lectura ya andando.
          if (index === 0 && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            await new Promise((resolve) => setTimeout(resolve, OPENING.ms));
          }
        }
      } finally {
        window.clearInterval(creep);
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
      setFetching(null);
      setStatus({ kind: "loading" });
      setTitle(input.name);
      setArchived(false);
      setBuilt(null);
      liveRef.current = null;

      try {
        const canvas = canvasRef.current;
        if (!canvas) throw new Error("Canvas no disponible");

        // En el celular el selector no filtra (iOS no reconoce las extensiones de cómic), así
        // que puede llegar cualquier cosa. Sin extensión se intenta igual: el contenido manda.
        const ext = /\.([^./]+)$/.exec(input.name)?.[1]?.toLowerCase();
        if (ext && !OPENABLE.has(ext)) {
          throw new ProblemError({ code: "notATome", ext });
        }

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
        setStatus({ kind: "error", problem: problemOf(err) });
      }
    },
    [build, mount, teardown],
  );

  /**
   * Abre un tomo desde un link: lo baja directo al navegador y sigue como si se lo hubiera
   * elegido del dispositivo.
   */
  const openUrl = useCallback(
    async (link: string) => {
      fetchAbort.current?.abort();
      const abort = new AbortController();
      fetchAbort.current = abort;

      try {
        const url = resolveLink(link);
        setStatus({ kind: "loading" });
        setFetching({ received: 0, total: null });
        const file = await download(url, setFetching, abort.signal);
        if (abort.signal.aborted) return;
        await open(file);
      } catch (err) {
        if (abort.signal.aborted) return;
        setFetching(null);
        setStatus({ kind: "error", problem: problemOf(err) });
      } finally {
        if (fetchAbort.current === abort) fetchAbort.current = null;
      }
    },
    [open],
  );

  // `?url=` en la dirección abre ese tomo de una: sirve para mandar un link que ya lo abre.
  useEffect(() => {
    const link = new URLSearchParams(window.location.search).get("url");
    if (link) void openUrl(link);
  }, [openUrl]);

  useEffect(() => () => fetchAbort.current?.abort(), []);

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

  /**
   * Gestos sobre la página, pensados primero para el celular.
   *
   * - Tocar: el tercio izquierdo avanza y el derecho retrocede —el manga se lee hacia la
   *   izquierda—; el centro muestra u oculta los controles.
   * - Deslizar rápido de lado: pasa de viñeta, como dar vuelta la hoja. Hacia la derecha
   *   avanza, porque lo que sigue está a la izquierda.
   * - Arrastrar: mueve la cámara. Pellizcar: zoom, anclado entre los dos dedos.
   */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    x0: number;
    y0: number;
    t0: number;
    moved: boolean;
    /** Hubo dos dedos en algún momento: ya no es un toque ni un deslizamiento. */
    multi: boolean;
    pinch: { dist: number; cx: number; cy: number } | null;
  } | null>(null);

  const pinchOf = (rect: DOMRect) => {
    const [a, b] = [...pointers.current.values()];
    return {
      dist: Math.hypot(b.x - a.x, b.y - a.y),
      cx: (a.x + b.x) / 2 - rect.left,
      cy: (a.y + b.y) / 2 - rect.top,
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!engine.current) return;
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      // El dedo ya se levantó cuando llegó el evento: sin captura el gesto sigue igual.
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 1) {
      gesture.current = {
        x0: e.clientX,
        y0: e.clientY,
        t0: performance.now(),
        moved: false,
        multi: false,
        pinch: null,
      };
    } else if (pointers.current.size === 2 && gesture.current) {
      gesture.current.multi = true;
      gesture.current.pinch = pinchOf((e.currentTarget as HTMLElement).getBoundingClientRect());
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    // Con el mouse, moverlo sobre la página alcanza para traer los controles.
    if (e.pointerType === "mouse" && e.buttons === 0) poke();

    const eng = engine.current;
    const prev = pointers.current.get(e.pointerId);
    const g = gesture.current;
    if (!eng || !prev || !g) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (g.pinch && pointers.current.size >= 2) {
      const next = pinchOf((e.currentTarget as HTMLElement).getBoundingClientRect());
      if (g.pinch.dist > 0) eng.stage.camera.zoomAt(next.dist / g.pinch.dist, next.cx, next.cy);
      eng.stage.camera.nudge(next.cx - g.pinch.cx, next.cy - g.pinch.cy);
      g.pinch = next;
      return;
    }
    if (g.multi) return;

    if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > TAP_SLOP) g.moved = true;
    eng.stage.camera.nudge(e.clientX - prev.x, e.clientY - prev.y);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    const eng = engine.current;
    if (!g || !eng) return;

    // Al levantar uno de los dos dedos el pellizco termina, pero el gesto sigue hasta que
    // se levanten todos: si no, el dedo que queda se tomaría como un toque.
    if (g.multi) {
      if (pointers.current.size === 1) g.pinch = null;
      if (pointers.current.size === 0) gesture.current = null;
      return;
    }
    gesture.current = null;

    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (g.moved) {
      const swipe =
        e.pointerType !== "mouse" &&
        performance.now() - g.t0 < SWIPE.ms &&
        Math.abs(dx) > SWIPE.px &&
        Math.abs(dx) > Math.abs(dy) * 1.5;
      if (swipe) (dx > 0 ? eng.director.next() : eng.director.prev());
      return;
    }

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const at = (e.clientX - rect.left) / rect.width;
    if (at < TAP_ZONE) eng.director.next();
    else if (at > 1 - TAP_ZONE) eng.director.prev();
    else toggleChrome();
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) gesture.current = null;
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
      {/* `touch-none` le saca al navegador el pellizco y el arrastre, que acá son de la
          cámara; sin el callout, mantener apretado no abre el menú de la imagen. */}
      <div
        className="absolute inset-0 touch-none select-none [-webkit-touch-callout:none]"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onWheel={onWheel}
      >
        <canvas ref={canvasRef} className="block h-full w-full" />
      </div>

      {/* Solo aparece si la lectura alcanzó al procesamiento, que es raro: procesar una
          página lleva menos que leerla. */}
      {waiting && (
        <div className="pointer-events-none absolute inset-x-0 top-[max(1.5rem,env(safe-area-inset-top))] z-20 flex justify-center px-4">
          <span className="flex items-center gap-2 rounded-full border border-neutral-700/80 bg-neutral-900/85 px-4 py-2 text-xs text-neutral-300 backdrop-blur">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#00D9F5]" />
            {t.reader.waiting}
          </span>
        </div>
      )}

      {/* La primera vez con el dedo: dónde tocar. Se va sola o con el primer toque al centro. */}
      {hint && status.kind === "ready" && (
        <div
          className="pointer-events-none absolute inset-0 z-20 grid grid-cols-[35fr_30fr_35fr] text-center text-[13px] font-medium text-neutral-100 animate-[fade_5.2s_ease-in-out_forwards]"
          aria-hidden
        >
          <div className="flex items-center justify-center bg-[#00D9F5]/15 px-3">
            {t.reader.hintNext[0]}
            <br />
            {t.reader.hintNext[1]}
          </div>
          <div className="flex items-center justify-center px-2">
            {t.reader.hintCenter[0]}
            <br />
            {t.reader.hintCenter[1]}
          </div>
          <div className="flex items-center justify-center bg-[#FF2E88]/15 px-3">
            {t.reader.hintBack[0]}
            <br />
            {t.reader.hintBack[1]}
          </div>
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
            message={status.kind === "error" ? problemText(t, status.problem) : undefined}
            onFile={(file) => {
              fetchAbort.current?.abort();
              void open(file);
            }}
            onUrl={(link) => void openUrl(link)}
            download={fetching}
          />
        </div>
      )}

      {status.kind === "ready" && (
        <Toolbar
          visible={chrome}
          onActivity={poke}
          onHold={holdChrome}
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

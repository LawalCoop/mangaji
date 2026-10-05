"use client";

import { MANIFEST_FILENAME, Page, safeParseManifest, type CameraMove } from "@mangaji/format";
import { useCallback, useEffect, useRef, useState } from "react";
import { CbzSource, type ArchiveSource } from "../lib/archive";
import { Camera, type Transform, type Viewport } from "../lib/camera";
import { Director, frameDuration } from "../lib/director";
import { PageFrameSource, PanelFrameSource } from "../lib/frame-sources";
import { LiveSource } from "../lib/live-archive";
import { download, resolveLink, type DownloadProgress } from "../lib/remote";
import { problemText, useI18n } from "../lib/i18n";
import { ProblemError, problemOf, type Problem } from "../lib/notes";
import { DEFAULT_MOOD, MOOD_ORDER, MOODS, type MoodId } from "../lib/mood";
import { Music } from "../lib/music";
import { bookKey, forget, savedPage, savePage } from "../lib/progress";
import { shelf, shelvedPages, type ShelvedPage } from "../lib/shelf";
import { directedShot, FIT_MARGIN, type DirectedShot, type Pan } from "../lib/directed";
import type { ProcessedPage } from "../lib/process";
import { Stage } from "../lib/stage";
import { PAGES, directionOf, type Direction } from "../lib/memory";
import type { Frame, Rect } from "../lib/types";
import type { ProcessRequest, ProcessResponse } from "../lib/process.worker";
import { Landing } from "./landing";
import { Processing, type LogLine, type Preview, type Stage as ProcessStage } from "./processing";
import { Toolbar } from "./toolbar";
import { DemoView } from "./demo-view";
import { CPU_2D } from "../lib/canvas";

/** Hasta que la página se decodifica no se sabe su tamaño; esto evita un encuadre en cero. */
const ASSUMED_PAGE = { w: 1600, h: 2300 };
/** Aire alrededor del encuadre: pegar la viñeta al borde se siente asfixiante. */
/** Duración del viaje de la cámara entre viñetas de la misma página. */
const TRAVEL_MS = 520;
const DIRECTED_KEY = "mangaji:directed";
const PLAY_KEY = "mangaji:play";
/**
 * Reproducción sola: cuánto se queda cada viñeta. Lo que dura su diálogo, estirado —los tiempos
 * de los beats son para quien toca—, más un respiro para mirar el dibujo; una viñeta sin texto
 * se mira un rato y sigue.
 */
const PLAY = { stretch: 1.9, breath: 1400, mute: 2200 };

function playTime(frame: Frame, fallback: number): number {
  const reveals = frame.beats.filter((b) => b.reveal !== undefined).length;
  const base = frameDuration(frame, fallback);
  return reveals ? base * PLAY.stretch + PLAY.breath : PLAY.mute;
}
/** Lo más que se espera, en la pantalla de carga, a que se termine de dibujar lo encontrado. */
const LIVE_SHOW_MAX = 2500;
/** Y lo menos: una tapa trae una sola viñeta, y si no, ni se llega a ver. */
const LIVE_SHOW_MIN = 1800;
const SHADE_KEY = "mangaji:shade";
const BACKDROP_KEY = "mangaji:backdrop";
/** Con la sombra prendida, lo oscuro que llega a estar lo más lejano de la viñeta enfocada. */
const SHADE = 0.72;
/**
 * Con estas páginas listas por delante, el procesamiento espera a que la cámara pare. Si el
 * lector ya está esperando la página siguiente, no espera.
 */
const MOTION_AHEAD = 1;
/** Lo máximo que espera, para que un lector que avanza sin parar no frene el tomo. */
const MOTION_WAIT_MAX = 2000;
/**
 * Tandas: con `pause` páginas listas por delante se deja de procesar hasta que queden
 * `resume`, salvo que el lector esté quieto.
 */
const BATCH = { pause: 5, resume: 2 };
/** Cuánto sin mover la cámara cuenta como lector quieto, que se aprovecha para procesar. */
const IDLE_MS = 3000;

/**
 * Apertura: la primera página no aparece, se descubre.
 *
 * La cámara arranca en un primer plano sobre el centro de la tapa y se aleja, sin moverse de
 * lado, hasta mostrarla entera mientras la pantalla se despeja. Antes arrancaba corrida hacia
 * una esquina y viajaba en diagonal, y se leía como un deslizamiento más que como una
 * apertura. Es el momento en que el lector entiende de qué se trata, así que se toma su tiempo.
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
/** A partir de cuánto apoyar el dedo deja de ser un toque y pasa a ser una pausa. */
const HOLD_MS = 280;
/** Manteniendo una flecha, cuánto tarda en recorrerse el paneo entero. */
const KEY_SCRUB_MS = 2500;
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
/**
 * Hasta dónde se puede alejar y acercar a mano, según la página que se está leyendo: alejar
 * hasta verla entera con aire alrededor —más lejos es mirar el fondo, y aparece el borde de
 * la sombra—; acercar hasta unas veces esa vista, que ya muestra la trama de la impresión.
 */
const ZOOM = { out: 0.8, in: 6 };

function zoomLimits(eng: { stage: { viewport: Viewport }; director: { frame: { page: number } }; sizes: { w: number; h: number }[] }) {
  const { w, h } = eng.stage.viewport;
  const page = eng.sizes[eng.director.frame.page] ?? ASSUMED_PAGE;
  const whole = Math.min(w / page.w, h / page.h);
  return { min: whole * ZOOM.out, max: whole * ZOOM.in };
}

/** Una página en chico, como imagen, para la pantalla de carga. */
function thumbnail(bitmap: ImageBitmap): string {
  const w = 480;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = Math.round((w * bitmap.height) / bitmap.width);
  canvas.getContext("2d", CPU_2D)!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.8);
}

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

/**
 * Un tomo que llega ya listo de afuera —el portal de una editorial— en vez de elegirse en la
 * portada: se abre solo, sin pasar por ella.
 */
export type RemoteBook = {
  open: () => Promise<ArchiveSource>;
  title: string;
  /** Para recordar por dónde se va. */
  key: string;
  /** Salir del lector: volver a la ficha de la serie, por ejemplo. */
  exit?: { label: string; onClick: () => void };
  /** Abrir en esta página (desde 0) en vez de donde se había quedado. */
  startPage?: number;
  /** Por dónde se va (página desde 0), para guardarlo afuera: en la cuenta del portal. */
  onPage?: (page: number, pages: number) => void;
};

export default function ReaderView({ remote }: { remote?: RemoteBook } = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const remoteRef = useRef(remote);
  remoteRef.current = remote;
  const engine = useRef<{
    source: ArchiveSource;
    stage: Stage;
    director: Director;
    sizes: { w: number; h: number }[];
    pageFrames: PageFrameSource;
    panelFrames: PanelFrameSource | null;
    /** El paneo de la cámara β, para pausarlo y moverlo con el dedo. */
    pan: { hold: (on: boolean) => boolean; scrub: (dx: number, dy: number) => void; step: (dp: number) => void };
    dispose: () => void;
  } | null>(null);
  /** El archivo que se está escribiendo, para poder guardarlo cuando esté completo. */
  const liveRef = useRef<LiveSource | null>(null);
  const workerRef = useRef<Worker | null>(null);
  /** Hasta cuándo se está moviendo la cámara: el procesamiento le cede la placa mientras. */
  const motionUntil = useRef(0);

  const [status, setStatus] = useState<Status>({ kind: "idle" });
  /** Modo demo (`?demo=on`): cuenta el proceso página por página, para charlas y stands. */
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("demo");
    setDemo(v === "on" || v === "1");
  }, []);
  const [title, setTitle] = useState("");
  /** El tomo abierto, para anotar por dónde se va. */
  const bookRef = useRef<string | null>(null);
  /**
   * Retomar donde se dejó: la página a la que hay que ir apenas esté lista, y si el aviso
   * se muestra. Mientras se procesa, la página puede tardar en llegar.
   */
  const resumeRef = useRef<number | null>(null);
  const [resume, setResume] = useState<{ page: number; ready: boolean } | null>(null);
  /** Lo que se muestra mientras se espera la primera página de un CBZ. */
  const [stage, setStage] = useState<ProcessStage | null>(null);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  /** La página que se está procesando, en chico, para mostrarla mientras se espera. */
  const [preview, setPreview] = useState<Preview | null>(null);
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
  /**
   * Cámara experimental: el ritmo y el movimiento siguen la tensión de cada escena, a la
   * DynamicManga. Se prende desde la barra y se recuerda por navegador.
   */
  const [directed, setDirected] = useState(false);
  const directedRef = useRef(false);
  useEffect(() => {
    try {
      const on = localStorage.getItem(DIRECTED_KEY) === "1";
      directedRef.current = on;
      setDirected(on);
    } catch {
      // Sin almacenamiento: queda apagada.
    }
  }, []);
  /**
   * Sombra: lo lejano a la viñeta que se lee se va a oscuras. Aparte de la cámara β, desde
   * la barra, y recordada por navegador como ella.
   */
  const [shade, setShade] = useState(false);
  const shadeRef = useRef(false);
  useEffect(() => {
    try {
      const on = localStorage.getItem(SHADE_KEY) === "1";
      shadeRef.current = on;
      setShade(on);
    } catch {
      // Sin almacenamiento: queda apagada.
    }
  }, []);
  // Va y viene también con un tomo ya abierto.
  useEffect(() => {
    const eng = engine.current;
    if (!eng) return;
    eng.stage.focusShadow = shade ? SHADE : 0;
    eng.stage.refocus(eng.director.frame);
    eng.stage.render();
  }, [shade]);
  /** Fondo: la tapa del tomo en trama, detrás de la página. Desde la barra, recordado. */
  const [backdrop, setBackdropOn] = useState(false);
  const backdropRef = useRef(false);
  useEffect(() => {
    try {
      const on = localStorage.getItem(BACKDROP_KEY) === "1";
      backdropRef.current = on;
      setBackdropOn(on);
    } catch {
      // Sin almacenamiento: queda apagado.
    }
  }, []);
  /** Pone o saca la tapa de fondo en el motor que esté andando. */
  const applyBackdrop = useCallback(async (on: boolean) => {
    const eng = engine.current;
    if (!eng) return;
    if (!on) eng.stage.setBackdrop(null);
    else {
      try {
        // La tapa es la primera página; si no se puede leer, se queda sin fondo.
        eng.stage.setBackdrop(await eng.source.peek(0));
      } catch {
        eng.stage.setBackdrop(null);
      }
    }
    eng.stage.refocus(eng.director.frame);
    eng.stage.render();
  }, []);
  useEffect(() => {
    void applyBackdrop(backdrop);
  }, [backdrop, applyBackdrop]);
  const toggleBackdrop = useCallback(() => {
    const on = !backdropRef.current;
    backdropRef.current = on;
    setBackdropOn(on);
    try {
      localStorage.setItem(BACKDROP_KEY, on ? "1" : "0");
    } catch {
      // Sin almacenamiento: dura lo que dure la pestaña.
    }
  }, []);
  const toggleShade = useCallback(() => {
    const on = !shadeRef.current;
    shadeRef.current = on;
    setShade(on);
    try {
      localStorage.setItem(SHADE_KEY, on ? "1" : "0");
    } catch {
      // Sin almacenamiento: dura lo que dure la pestaña.
    }
  }, []);
  /** Reproducir solo: globos, viñetas y páginas pasan sin tocar. Desde la barra, recordado. */
  const [playing, setPlaying] = useState(false);
  const playRef = useRef(false);
  useEffect(() => {
    try {
      const on = localStorage.getItem(PLAY_KEY) === "1";
      playRef.current = on;
      setPlaying(on);
    } catch {
      // Sin almacenamiento: queda apagado.
    }
  }, []);
  const setPlay = useCallback((on: boolean) => {
    playRef.current = on;
    setPlaying(on);
    const director = engine.current?.director;
    if (director) on ? director.play() : director.pause();
    try {
      localStorage.setItem(PLAY_KEY, on ? "1" : "0");
    } catch {
      // Sin almacenamiento: dura lo que dure la pestaña.
    }
  }, []);
  const togglePlay = useCallback(() => setPlay(!playRef.current), [setPlay]);
  const toggleDirected = useCallback(() => {
    const on = !directedRef.current;
    directedRef.current = on;
    setDirected(on);
    try {
      localStorage.setItem(DIRECTED_KEY, on ? "1" : "0");
    } catch {
      // Sin almacenamiento: dura lo que dure la pestaña.
    }
  }, []);
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
  /** Salta a la página a retomar si ya está lista; si no, queda pendiente y se avisa. */
  const tryResume = useCallback((director: Director) => {
    const page = resumeRef.current;
    if (page === null) return;
    for (let i = 0; i < director.length; i++) {
      if (director.frameAt(i).page === page) {
        resumeRef.current = null;
        director.seek(i);
        setResume({ page, ready: true });
        window.setTimeout(() => setResume((r) => (r?.ready ? null : r)), 6000);
        return;
      }
    }
    setResume({ page, ready: false });
  }, []);

  /** Empezar el tomo desde el principio, olvidando por dónde se iba. */
  const restart = useCallback(() => {
    resumeRef.current = null;
    setResume(null);
    if (bookRef.current) forget(bookRef.current);
    engine.current?.director.seek(0);
  }, []);

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
        /** Cámara experimental: los tramos a tiempo del plano, uno detrás del otro. */
        let queued: { left: number; to: Transform; ms: number; shake: number }[] = [];
        const steps = (shot: DirectedShot, wait: number) => {
          let prevAt = 0;
          return shot.steps.map((st, i) => {
            const at = st.at ?? 0;
            const left = (i === 0 ? wait : 0) + (at - prevAt) * moodRef.current.pace;
            prevAt = at;
            return { left, to: st.to, ms: st.ms * moodRef.current.pace, shake: i === 0 ? shot.shake : 0 };
          });
        };
        /**
         * Cámara experimental: el paneo en curso. Avanza parejo en cada cuadro, sin pasar un
         * globo que todavía no apareció, y al terminar —o si se pide avanzar antes— muestra
         * la viñeta entera.
         */
        let pan: (Pan & { p: number; delay: number; final: Transform; done: boolean; held: boolean }) | null = null;
        /** Hasta dónde puede llegar el paneo: el próximo globo que falta aparecer, o el final. */
        const panLimit = () => {
          if (!pan) return 1;
          const next = pan.stops.find((st) => !revealed.has(st.id));
          return next ? next.at : 1;
        };
        const placePan = () => {
          if (!pan) return;
          const k = pan.p;
          stage.camera.cut({
            scale: pan.start.scale + (pan.end.scale - pan.start.scale) * k,
            x: pan.start.x + (pan.end.x - pan.start.x) * k,
            y: pan.start.y + (pan.end.y - pan.start.y) * k,
          });
        };
        /**
         * Con el dedo apoyado el paneo se pausa; arrastrando se lo mueve por su recorrido —para
         * atrás o para adelante, sin pasar un globo que falta—, y al soltar sigue desde ahí.
         */
        const panControl = {
          hold: (on: boolean) => {
            if (!pan || pan.done) return false;
            pan.held = on;
            return true;
          },
          scrub: (dx: number, dy: number) => {
            if (!pan || pan.done) return;
            const ddx = pan.end.x - pan.start.x;
            const ddy = pan.end.y - pan.start.y;
            const len2 = ddx * ddx + ddy * ddy;
            if (len2 <= 0) return;
            pan.delay = 0;
            pan.p = Math.min(panLimit(), Math.max(0, pan.p + (dx * ddx + dy * ddy) / len2));
            placePan();
          },
          /** Mueve el paneo una fracción de su recorrido: positivo hacia el final. */
          step: (dp: number) => {
            if (!pan || pan.done) return;
            pan.delay = 0;
            pan.p = Math.min(panLimit(), Math.max(0, pan.p + dp));
            placePan();
          },
        };
        const finishPan = () => {
          if (!pan || pan.done) return false;
          pan.done = true;
          stage.camera.glide(pan.final, 800 * moodRef.current.pace);
          return true;
        };
        // Tocar durante el paneo lo corta: la viñeta entera, con todo su diálogo. El toque
        // siguiente ya pasa de viñeta.
        // Reproducción sola: más tiempo que tocando, y sin cortar un paneo a la mitad.
        director.playDuration = (frame) => playTime(frame, director.defaultHold);
        director.canAdvance = () => !pan || pan.done;
        if (playRef.current) director.play();
        director.holdNext = () => {
          if (!finishPan()) return false;
          director.revealAll();
          return true;
        };
        /** Cámara experimental: ritmo de lectura de la viñeta actual. */
        let readingPace = 1;
        /** Apariciones de diálogo en curso, avanzadas por el ticker. */
        const revealing = new Map<string, { elapsed: number; ms: number }>();
        /**
         * Diálogo ya revelado en esta página. Un globo apoyado sobre el borde pertenece a
         * las dos viñetas que liga, y al pasar a la vecina tiene que seguir ahí en vez de
         * volver a aparecer.
         */
        const revealed = new Set<string>();
        /** Hacia dónde se viene leyendo, para preparar las páginas de ese lado. */
        let readingDirection: Direction = 1;
        let lastPage = 0;
        const draw = async (immediate: boolean) => {
          const mine = ++token;
          const frame = director.frame;
          const pos = director.positionInPage;
          if (bookRef.current && resumeRef.current === null) {
            savePage(bookRef.current, frame.page, sizes.length);
            remoteRef.current?.onPage?.(frame.page, sizes.length);
          }
          // Si se empezó a avanzar por cuenta propia antes de que llegara la página a retomar,
          // se eligió leer desde el principio: ya no se salta.
          if (resumeRef.current !== null && director.index > 2) {
            resumeRef.current = null;
            setResume(null);
          }
          setAt({
            page: frame.page + 1,
            pages: sizes.length,
            panel: pos.index,
            panels: pos.total,
            progress: director.length > 1 ? director.index / (director.length - 1) : 1,
          });

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

            // Si la página tarda —se soltó para ahorrar memoria y hay que decodificarla de
            // nuevo—, se avisa como cuando se lee más rápido de lo que se procesa.
            const slow = window.setTimeout(() => {
              if (mine === token) setWaiting(true);
            }, 250);
            const [bitmap, dialogue] = await Promise.all([
              source.bitmap(frame.page),
              Promise.all(
                pageLayers.map(async (layer) => ({
                  id: layer.id,
                  rect: layer.rect,
                  bitmap: await source.bitmapOf(layer.src),
                })),
              ),
            ]).finally(() => window.clearTimeout(slow));
            if (mine !== token) return;
            setWaiting(false);

            // Las que vienen, en la dirección en que se lee (volviendo, las de atrás), y una
            // para el otro lado: cambiar de idea no tiene que hacer esperar. Después de pedir
            // esta, que es la que le dice a la fuente dónde se está leyendo.
            readingDirection = directionOf(frame.page, lastPage, readingDirection);
            lastPage = frame.page;
            for (let k = 1; k <= PAGES.prefetch; k++) source.prefetch(frame.page + k * readingDirection);
            source.prefetch(frame.page - readingDirection);

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
            const shot =
              directedRef.current && fresh.tension !== undefined && !director.reducedMotion
                ? directedShot(fresh, stage.viewport)
                : null;
            const { from, to } = shot
              ? { from: shot.from, to: shot.final }
              : framing(cam, fresh.rect, stage.viewport);
            readingPace = shot?.pace ?? 1;
            queued = [];
            pan = null;

            if (immediate && !director.reducedMotion && opening) {
              opening = false;
              // Plano cerrado sobre el ángulo por donde se empieza a leer, y desde ahí se
              // abre a la página entera.
              // Primer plano sobre el centro de la tapa, que se abre sin desplazarse hasta
              // mostrarla entera.
              stage.camera.cut(Camera.fit(fresh.rect, stage.viewport, FIT_MARGIN * OPENING.zoom));
              stage.camera.glide(to, OPENING.ms * moodRef.current.pace);
              stage.openCurtain(OPENING.curtain);
            } else if (immediate || director.reducedMotion) {
              opening = false;
              stage.camera.cut(to);
            } else if (samePage && shot) {
              // Experimental: se viaja al arranque del plano y desde ahí se hace el movimiento.
              const travel = TRAVEL_MS * moodRef.current.pace;
              stage.camera.glide(from, travel);
              queued = steps(shot, travel * 0.8);
              if (shot.pan) pan = { ...shot.pan, p: 0, delay: travel * 0.8, final: shot.final, done: false, held: false };
            } else if (samePage) {
              // Dentro de la página la cámara viaja: es lo que da la sensación de estar
              // recorriendo la hoja en vez de ver recortes sueltos.
              stage.camera.glide(to, TRAVEL_MS * moodRef.current.pace);
            } else if (shot) {
              stage.camera.cut(from);
              queued = steps(shot, 0);
              if (shot.pan) pan = { ...shot.pan, p: 0, delay: 0, final: shot.final, done: false, held: false };
              if (shot.pan && shot.shake) stage.camera.shake(shot.shake, 500);
            } else {
              // Página nueva: se entra con el movimiento que pida el beat.
              stage.camera.cut(from);
              stage.camera.glide(to, Math.max(fresh.beats[0]?.ms ?? 0, 260));
            }
            // Lo que dura el movimiento que se acaba de pedir, con margen para la cámara en
            // mano y la aparición del diálogo.
            motionUntil.current = performance.now() + 1400 * moodRef.current.pace;
            stage.render();
          } catch (err) {
            if (mine === token) {
              console.error("[mangaji]", err);
              setStatus({ kind: "error", problem: problemOf(err) });
            }
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
          // Terminó el tomo: el botón vuelve a play, sin olvidar que se quería solo.
          if (ev.type === "end") {
            setPlaying(false);
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
          // Con el paneo pausado bajo el dedo, el diálogo también espera.
          if (!pan?.held) director.tick(dt / (moodRef.current.pace * readingPace));
          // Los tramos de la cámara experimental, uno detrás del otro.
          if (pan && !pan.done && !pan.held) {
            if (pan.delay > 0) pan.delay -= dt;
            else {
              const speed = 1 / (pan.ms * moodRef.current.pace);
              pan.p = Math.min(panLimit(), pan.p + dt * speed);
              placePan();
              if (pan.p >= 1) finishPan();
            }
          }
          const step = queued[0];
          if (step) {
            step.left -= dt;
            if (step.left <= 0) {
              stage.camera.glide(step.to, step.ms);
              if (step.shake) stage.camera.shake(step.shake, 500);
              queued.shift();
            }
          }
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
        stage.focusShadow = shadeRef.current ? SHADE : 0;

        tryResume(director);
        engine.current = {
          source,
          stage,
          director,
          sizes,
          pageFrames,
          panelFrames,
          pan: panControl,
          dispose: () => {
            window.removeEventListener("resize", onResize);
            offTick();
            offDirector();
            stage.destroy();
            source.close();
          },
        };
        // La tapa de fondo, si está prendida: con el motor ya armado.
        if (backdropRef.current) void applyBackdrop(true);

        setStatus({ kind: "ready" });
        void draw(true);
      } catch (err) {
        console.error("[mangaji]", err);
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
      setPreview(null);
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
      // Lo ya procesado de este tomo en otra visita: se carga y se sigue desde lo que falta.
      // Si están todas las páginas, ni se descomprime el archivo, que es lo que más tarda.
      const key = bookRef.current;
      const shelved = key ? await shelvedPages(key) : { pages: [], total: null };
      const complete = shelved.total !== null && shelved.pages.length >= shelved.total;

      let cbz: CbzSource | null = null;
      if (!complete) {
        try {
          cbz = await CbzSource.open(file);
        } catch (err) {
          window.clearInterval(creep);
          throw err;
        }
      }
      const total = cbz ? cbz.pageCount : shelved.total!;
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

      const saved = shelved.pages;
      // También si falta anotar el total, como en lo guardado antes de que se anotara.
      const store = key && (saved.length < total || shelved.total === null) ? await shelf(key, total) : null;

      const worker = new Worker(new URL("../lib/process.worker.ts", import.meta.url), {
        type: "module",
      });
      workerRef.current = worker;

      const marks: number[] = [];
      const settle = new Map<number, () => void>();
      let mounted = false;
      /** Hasta cuándo dejar a la vista lo que la IA encontró en la primera página. */
      let liveUntil = 0;
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
          // Lo que encontró en la página, que la pantalla de carga dibuja: hay que darle tiempo.
          if (msg.note.key === "liftingDialogue" && msg.note.shapes) {
            const { panels, texts } = msg.note.shapes;
            liveUntil = performance.now() + Math.min(LIVE_SHOW_MAX, Math.max(LIVE_SHOW_MIN, panels.length * 220 + texts.length * 60 + 900));
          }
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

        await accept(msg.page);
      };

      /** Una página lista, recién procesada o traída de lo guardado. */
      const accept = async (done: ProcessedPage | ShelvedPage, fromShelf = false) => {
        live.add(done);
        if (!fromShelf) void store?.(done as ProcessedPage);
        sizes[done.index] = { w: done.size[0], h: done.size[1] };
        ready[done.index] = sizes[done.index];

        // El manifest se valida página por página: el streaming no afloja las garantías que
        // daba leerlo entero de un archivo terminado.
        const parsed = Page.safeParse(done.page);
        // En desarrollo queda a mano cómo se leyó cada página, para revisar el procesamiento.
        if (process.env.NODE_ENV !== "production") {
          const w = window as unknown as { __mangajiPages?: unknown[]; __mangajiDebug?: unknown[] };
          (w.__mangajiPages ??= [])[done.index] = done.page;
          (w.__mangajiDebug ??= [])[done.index] = done.debug;
        }
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
          // Que se llegue a ver lo que encontró la IA antes de abrir el lector.
          const left = liveUntil - performance.now();
          if (left > 0) await new Promise((resolve) => setTimeout(resolve, left));
          await mount(canvas, live, sizes, pageFrames, panelFrames);
        } else {
          engine.current?.director.grew();
          if (engine.current) tryResume(engine.current.director);
        }

        settle.get(done.index)?.();
      };

      try {
        for (const page of saved) {
          if (page.index >= total) break;
          await accept(page, true);
        }
        for (let index = Math.min(saved.length, total); index < total; index++) {
          // El procesamiento comparte la placa y el procesador con el dibujo, y en el celular
          // la lectura iba a tirones mientras corría. Se trabaja de a tandas: con varias
          // páginas listas por delante, se espera a que el lector se acerque o se quede
          // quieto; con pocas, solo a que la cámara termine de moverse. Si el lector ya está
          // esperando la página siguiente, no se espera nada.
          const waitStart = performance.now();
          for (;;) {
            const eng = engine.current;
            if (!eng || eng.director.waiting) break;
            const ahead = index - eng.director.frame.page;
            const now = performance.now();
            const idle = now - motionUntil.current >= IDLE_MS;
            if (ahead >= BATCH.pause) {
              if (idle) break;
              // Pausado hasta que se acerque: sigue cuando quedan pocas.
              await new Promise((resolve) => setTimeout(resolve, 200));
              if (index - (engine.current?.director.frame.page ?? 0) <= BATCH.resume) break;
              continue;
            }
            if (ahead < MOTION_AHEAD || now >= motionUntil.current) break;
            if (now - waitStart > MOTION_WAIT_MAX) break;
            await new Promise((resolve) => setTimeout(resolve, 80));
          }
          const bitmap = await cbz!.bitmap(index);
          // Mientras se ve la pantalla de carga, la página en chico: ahí se muestra lo que la
          // IA va encontrando. Antes de mandarla, que después ya no es nuestra.
          if (!mounted) setPreview({ index, src: thumbnail(bitmap), aspect: bitmap.width / bitmap.height });
          const settled = new Promise<void>((resolve) => settle.set(index, resolve));
          // El bitmap se transfiere, no se copia; por eso se saca de la caché del archivo,
          // que si no queda apuntando a una imagen que ya no es suya.
          worker.postMessage({ kind: "page", index, bitmap } satisfies ProcessRequest, [bitmap]);
          cbz!.release(index);
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
        cbz?.close();
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
      bookRef.current = bookKey(input);
      resumeRef.current = savedPage(bookRef.current);
      setResume(null);
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

        await openSource(canvas, await CbzSource.open(input));
      } catch (err) {
        console.error("[mangaji]", err);
        setStatus({ kind: "error", problem: problemOf(err) });
      }
    },
    [build, mount, teardown],
  );

  /**
   * Cierra el tomo y vuelve a la portada. Suelta todo —páginas, texturas, el procesamiento si
   * estaba en curso— como al abrir otro; por dónde se iba ya quedó anotado.
   */
  const closeBook = useCallback(() => {
    fetchAbort.current?.abort();
    teardown();
    liveRef.current = null;
    bookRef.current = null;
    resumeRef.current = null;
    setResume(null);
    setBuilt(null);
    setEta(null);
    setArchived(false);
    setFetching(null);
    setTitle("");
    setStatus({ kind: "idle" });
    // Sin el `?url=` que lo abrió: si no, recargar la portada lo volvería a abrir.
    if (new URLSearchParams(window.location.search).has("url")) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [teardown]);

  /** Monta una fuente ya abierta: un `.cbza` del dispositivo o un tomo del portal. */
  const openSource = useCallback(
    async (canvas: HTMLCanvasElement, source: ArchiveSource) => {
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
    },
    [mount],
  );

  // Un tomo del portal se abre solo, apenas está el lienzo.
  useEffect(() => {
    if (!remote) return;
    let cancelled = false;
    void (async () => {
      teardown();
      setStatus({ kind: "loading" });
      setTitle(remote.title);
      bookRef.current = remote.key;
      resumeRef.current = remote.startPage ?? savedPage(remote.key);
      setResume(null);
      try {
        const canvas = canvasRef.current;
        if (!canvas) throw new Error("Canvas no disponible");
        const source = await remote.open();
        if (cancelled) return source.close();
        await openSource(canvas, source);
      } catch (err) {
        if (!cancelled) {
          console.error("[mangaji]", err);
          setStatus({ kind: "error", problem: problemOf(err) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Solo al montar: `remote` llega una vez por tomo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    eng.stage.camera.zoomAt(factor, w / 2, h / 2, zoomLimits(eng));
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

    const { packArchive } = await import("../lib/process");
    // Las páginas traídas de lo guardado están en el archivo, sin leer: se leen recién acá.
    const bytes = async (b: Uint8Array | Blob) => (b instanceof Blob ? new Uint8Array(await b.arrayBuffer()) : b);
    const pages = await Promise.all(
      live.pages.map(async (p) => ({
        ...p,
        image: await bytes(p.image),
        sprites: Object.fromEntries(
          await Promise.all(Object.entries(p.sprites).map(async ([k, v]) => [k, await bytes(v)] as const)),
        ),
      })),
    );
    const url = URL.createObjectURL(packArchive(pages));
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
    // Mantener una flecha hace con el paneo de la cámara β lo mismo que mantener el dedo: lo
    // pausa, y mientras sigue apretada lo mueve —← hacia adelante, → hacia atrás—. Al
    // soltarla sigue. Una pulsación corta hace lo de siempre.
    let held: { key: string; t0: number; moving: boolean; timer: number; last: number } | null = null;
    const moveHeld = (now: number) => {
      if (!held) return;
      const eng = engine.current;
      if (!eng) return;
      const dt = now - held.last;
      held.last = now;
      if (now - held.t0 < HOLD_MS) return;
      held.moving = true;
      eng.pan.step(((held.key === "ArrowLeft" ? 1 : -1) * dt) / KEY_SCRUB_MS);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!held || e.key !== held.key) return;
      const eng = engine.current;
      window.clearInterval(held.timer);
      const short = !held.moving && performance.now() - held.t0 < HOLD_MS;
      const key = held.key;
      held = null;
      eng?.pan.hold(false);
      if (short && eng) (key === "ArrowLeft" ? eng.director.next() : eng.director.prev());
    };

    const onKey = (e: KeyboardEvent) => {
      const eng = engine.current;
      if (!eng) return;
      if (!e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        if (held) {
          e.preventDefault();
          return;
        }
        if (!e.repeat && eng.pan.hold(true)) {
          e.preventDefault();
          const now = performance.now();
          held = { key: e.key, t0: now, moving: false, last: now, timer: 0 };
          held.timer = window.setInterval(() => moveHeld(performance.now()), 16);
          return;
        }
      }
      // Con Shift, las flechas de siempre saltan la página entera.
      if (e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        eng.director.seekToPage(eng.director.frame.page + (e.key === "ArrowLeft" ? 1 : -1));
        return;
      }
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
        case "p":
          togglePlay();
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
    // Si la ventana pierde el foco con la flecha apretada, el soltarla no llega: se suelta acá.
    const onBlur = () => {
      if (!held) return;
      window.clearInterval(held.timer);
      held = null;
      engine.current?.pan.hold(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      if (held) window.clearInterval(held.timer);
    };
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
    /** El dedo pausó un paneo de la cámara β: arrastrar lo mueve en vez de la página. */
    panning: boolean;
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
        panning: engine.current.pan.hold(true),
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
      if (g.pinch.dist > 0) eng.stage.camera.zoomAt(next.dist / g.pinch.dist, next.cx, next.cy, zoomLimits(eng));
      eng.stage.camera.nudge(next.cx - g.pinch.cx, next.cy - g.pinch.cy);
      g.pinch = next;
      return;
    }
    if (g.multi) return;

    if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > TAP_SLOP) g.moved = true;
    if (g.panning) eng.pan.scrub(e.clientX - prev.x, e.clientY - prev.y);
    else eng.stage.camera.nudge(e.clientX - prev.x, e.clientY - prev.y);
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

    // Se soltó un paneo pausado: sigue. Si fue una pausa larga o se lo arrastró, termina acá;
    // un toque corto, en cambio, corta el paneo y va a la viñeta entera.
    if (g.panning) {
      eng.pan.hold(false);
      if (g.moved || performance.now() - g.t0 > HOLD_MS) return;
    }

    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (g.moved) {
      const swipe =
        e.pointerType !== "mouse" &&
        performance.now() - g.t0 < SWIPE.ms &&
        Math.abs(dx) > SWIPE.px &&
        Math.abs(dx) > Math.abs(dy) * 1.5;
      if (swipe) (dx > 0 ? eng.director.next() : eng.director.prev());
      // Deslizar hacia arriba o abajo salta la página entera, sin pasar globo por globo.
      const flick =
        e.pointerType !== "mouse" &&
        performance.now() - g.t0 < SWIPE.ms &&
        Math.abs(dy) > SWIPE.px &&
        Math.abs(dy) > Math.abs(dx) * 1.5;
      if (flick) eng.director.seekToPage(eng.director.frame.page + (dy < 0 ? 1 : -1));
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
    if (gesture.current?.panning) engine.current?.pan.hold(false);
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
      zoomLimits(eng),
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
      {/* Retomar: dónde se sigue, con la salida para empezar de nuevo a mano. */}
      {resume && status.kind === "ready" && (
        // Con el botón de salir del portal arriba a la izquierda, el aviso baja para no taparlo.
        <div className={`absolute inset-x-0 z-20 flex justify-center px-4 top-[max(4.25rem,calc(env(safe-area-inset-top)+3.5rem))]`}>
          <span className="flex items-center gap-3 rounded-full border border-neutral-700/80 bg-neutral-900/90 py-1.5 pr-1.5 pl-4 text-xs text-neutral-200 backdrop-blur">
            {!resume.ready && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#00D9F5]" />}
            {resume.ready ? t.reader.resumed(resume.page + 1) : t.reader.resuming(resume.page + 1)}
            <button
              type="button"
              onClick={restart}
              className="rounded-full border border-neutral-600 px-3 py-1 text-neutral-100 hover:border-[#FF2E88] hover:text-white"
            >
              {t.reader.restart}
            </button>
          </span>
        </div>
      )}

      {waiting && !resume && (
        <div className={`pointer-events-none absolute inset-x-0 z-20 flex justify-center px-4 top-[max(4.25rem,calc(env(safe-area-inset-top)+3.5rem))]`}>
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
            <span>
              {t.reader.hintCenter[0]}
              <br />
              {t.reader.hintCenter[1]}
              <br />
              <span className="mt-3 block text-[12px] text-neutral-300">{t.reader.hintPage}</span>
            </span>
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
          <Processing title={title} stage={stage} lines={lines} progress={progress} eta={eta} preview={preview} />
        </div>
      )}

      {/* Un tomo del portal no pasa por la portada: mientras llega, solo eso; si falla, por qué. */}
      {remote && status.kind !== "ready" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center text-neutral-300">
          {status.kind === "error" ? (
            <p className="max-w-sm">{problemText(t, status.problem)}</p>
          ) : (
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#00D9F5]" aria-label={remote.title} />
          )}
          {remote.exit && status.kind === "error" && (
            <button type="button" onClick={remote.exit.onClick} className="rounded-full bg-neutral-800 px-5 py-2 text-sm">
              {remote.exit.label}
            </button>
          )}
        </div>
      )}

      {/* Salir del lector, junto con el resto de los controles. */}
      {/* Cerrar el tomo y volver a la portada, junto con el resto de los controles; al lado,
          la marca, que con el tomo abierto no aparecía en ningún lado. */}
      {!remote && (status.kind === "ready" || status.kind === "processing") && (
        <span
          aria-hidden
          className={`pointer-events-none absolute top-[max(0.75rem,env(safe-area-inset-top))] left-15 z-30 flex h-10 items-center transition-opacity duration-300 ${chrome || status.kind === "processing" ? "opacity-100" : "opacity-0"}`}
        >
          <span className="trim-caps font-[family-name:var(--display)] text-[22px] leading-none text-neutral-100 [text-shadow:0_1px_8px_rgb(0_0_0/0.7)]">
            MANGAJI
          </span>
          <span className="ml-2 h-4 w-[3px] bg-[#FF2E88]" />
        </span>
      )}
      {!remote && (status.kind === "ready" || status.kind === "processing") && (
        <button
          type="button"
          onClick={closeBook}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={t.reader.close}
          title={t.reader.close}
          className={`absolute top-[max(0.75rem,env(safe-area-inset-top))] left-3 z-30 flex size-10 items-center justify-center rounded-full border border-neutral-700/80 bg-neutral-900/85 text-neutral-200 backdrop-blur transition-opacity duration-300 hover:bg-neutral-800 ${chrome || status.kind === "processing" ? "opacity-100" : "pointer-events-none opacity-0"}`}
        >
          <svg viewBox="0 0 24 24" aria-hidden className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      )}

      {remote?.exit && status.kind === "ready" && (
        <button
          type="button"
          onClick={remote.exit.onClick}
          onPointerDown={(e) => e.stopPropagation()}
          className={`absolute top-[max(0.75rem,env(safe-area-inset-top))] left-3 z-30 flex h-10 items-center gap-2 rounded-full border border-neutral-700/80 bg-neutral-900/85 px-4 text-sm text-neutral-200 backdrop-blur transition-opacity duration-300 ${chrome ? "opacity-100" : "pointer-events-none opacity-0"}`}
        >
          <span aria-hidden>←</span>
          {remote.exit.label}
        </button>
      )}

      {!remote && status.kind !== "ready" && status.kind !== "processing" && (
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

      {demo && status.kind === "ready" && engine.current?.panelFrames && (
        <DemoView
          source={engine.current.source}
          frames={engine.current.panelFrames}
          title={title}
          onExit={remote?.exit?.onClick ?? closeBook}
        />
      )}

      {status.kind === "ready" && !demo && (
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
          directed={directed}
          onToggleDirected={toggleDirected}
          shade={shade}
          onToggleShade={toggleShade}
          playing={playing}
          onTogglePlay={togglePlay}
          backdrop={backdrop}
          onToggleBackdrop={toggleBackdrop}
        />
      )}
    </main>
  );
}

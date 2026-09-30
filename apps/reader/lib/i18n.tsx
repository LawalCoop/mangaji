"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Note, Problem } from "./notes";

/**
 * Idiomas del sitio.
 *
 * El español es la referencia: el tipo de los diccionarios sale de él, así que si a otro
 * idioma le falta una clave, no compila. Los textos del pipeline llegan como códigos
 * (`lib/notes.ts`) y se dicen acá, en el idioma que esté puesto en cada momento.
 */

export type Lang = "es" | "en" | "ja";

export const LANGS: { id: Lang; label: string; name: string }[] = [
  { id: "es", label: "ES", name: "Español" },
  { id: "en", label: "EN", name: "English" },
  { id: "ja", label: "日本語", name: "日本語" },
];

const STORAGE_KEY = "mangaji:lang";

const es = {
  meta: {
    title: "Mangaji — tu manga, animeizado",
  },
  language: "Idioma",

  landing: {
    subtitle: "Lector de manga",
    direction: "Se lee de derecha a izquierda y de arriba abajo, como el original en papel.",
    demoLabel:
      "Demostración: la cámara recorre una página de manga viñeta por viñeta, de derecha a izquierda, y el diálogo aparece cuando le toca.",
    tagline: "Lector de CBZ y CBR. Todo pasa en tu navegador.",
    headline: ["TU MANGA,", "ANIMEIZADO"],
    headlineLabel: "Tu manga, animeizado",
    intro:
      "Mangaji abre tus archivos CBZ y, en vez de dejarte la página entera enfrente, la recorre: encuadra cada viñeta, viaja hasta la siguiente y muestra el diálogo cuando le toca. Como ver el capítulo, salvo que el ritmo lo marcás vos.",
    bubbleIdle: "SUBÍ TU TOMO ACÁ",
    bubbleOpening: "ABRIENDO…",
    bubbleDownloading: "BAJANDO…",
    choose: "ELEGIR ARCHIVO",
    formats: "Abrí un .cbz o .cbr. Si ya lo procesaste antes, el .cbza carga directo.",
    linkLabel: "O PEGÁ UN LINK",
    linkOpen: "ABRIR",
    linkHelp: "Links directos, de Dropbox o de GitHub. Google Drive todavía no.",
    downloaded: (pct: number, got: string, total: string) => `${pct} % · ${got} de ${total} MB`,
    downloadedUnknown: (got: string) => `${got} MB`,
    privacy:
      "El archivo se abre y se procesa en tu navegador. Si viene de un link, se baja directo del sitio donde está, sin pasar por ningún servidor nuestro.",
    features: [
      {
        title: "MUESTRA EL DIÁLOGO",
        text: "Detecta los globos y muestra cada parlamento cuando le toca, con la pausa que pide la escena.",
      },
      {
        title: "MUEVE LA CÁMARA",
        text: "Encuadra una viñeta a la vez y se desplaza hasta la siguiente. En las escenas de acción corta seco; en las pausadas, viaja lento.",
      },
      {
        title: "ENCUENTRA LAS VIÑETAS",
        text: "Analiza la página y la separa cuadro por cuadro. Deduce en qué orden se leen, aun cuando la composición se parte en diagonales.",
      },
    ],
    madeBy: "Desarrollado por",
  },

  processing: {
    label: "PROCESANDO",
    headlineOpening: "Abriendo",
    headlineModels: "Cargando",
    headlinePage: "Leyendo la página",
    unpacking: "Descomprimiendo",
    pageOf: (page: number, total: number) => `Página ${page} de ${total}`,
    remaining: (eta: string) => `queda ${eta}`,
    firstTime:
      "La primera vez se bajan los detectores, unos 80 MB. Después el navegador los reutiliza. Si estás con datos, conviene wifi.",
    footer: "Todo esto pasa en tu navegador. El archivo no sale de tu máquina.",
    logPage: (page: number, text: string) => `página ${page}: ${text}`,
  },

  notes: {
    unpacking: "descomprimiendo el archivo",
    pageCount: (n: number) => `${n} páginas`,
    gpu: "acelerado por GPU",
    noGpu: "sin GPU: va a tardar bastante más",
    loadingPanels: "cargando el detector de viñetas",
    loadingDialogue: "cargando el detector de diálogo",
    findingPanels: "buscando viñetas",
    liftingDialogue: (n: number) => `${n} viñetas · levantando el diálogo`,
  },

  problems: {
    noImages: "El archivo no contiene imágenes.",
    notATome: (ext: string) => `Eso es un .${ext}, no un tomo. Elegí un archivo .cbz, .cbr o .cbza.`,
    linkEmpty: "Pegá un link.",
    linkInvalid: "Eso no parece un link.",
    linkDrive:
      "Los links de Google Drive todavía no se pueden abrir desde acá: Drive no deja que otras páginas bajen sus archivos. Bajalo y elegilo con el botón, o compartilo por Dropbox.",
    linkBlocked:
      "Ese sitio no deja que otras páginas bajen sus archivos. Probá con un link de Dropbox, o bajalo y elegilo con el botón.",
    offline: "No hay conexión.",
    linkMissing: "Ese link no lleva a ningún archivo: puede que lo hayan borrado.",
    linkPrivate: "Ese archivo es privado. Compartilo para que cualquiera con el link lo pueda ver.",
    linkHttp: (status: number) => `El sitio respondió con un error (${status}).`,
    linkPage: "El link lleva a una página, no al archivo. Buscá el link de descarga directa.",
    unexpected: (detail: string) => `No se pudo abrir: ${detail}`,
  },

  reader: {
    waiting: "preparando la página que sigue…",
    hintNext: ["tocá acá", "para avanzar"],
    hintCenter: ["centro:", "controles"],
    hintBack: ["acá para", "volver"],
  },

  toolbar: {
    goToPage: "Ir a una página",
    prevPage: "Página anterior (↑)",
    prevPanel: "Viñeta anterior (→)",
    nextPanel: "Viñeta siguiente (← o espacio)",
    nextPage: "Página siguiente (↓)",
    zoomOut: "Alejar (−)",
    fit: "Encuadrar (f)",
    zoomIn: "Acercar (+)",
    toggleMode: "Alternar viñeta / página (v)",
    modePanel: "viñeta",
    modePage: "página",
    intensity: (mood: string) => `Intensidad: ${mood}`,
    music: "Música (m)",
    musicOn: "♪ on",
    musicOff: "♪ off",
    volume: "Volumen",
    volumeLabel: "Volumen de la música",
    buildingTitle: "Las páginas que faltan se están procesando mientras leés",
    building: (done: number, total: number) => `procesando ${done} / ${total}`,
    remaining: (eta: string) => `· queda ${eta}`,
    saveTitle: "Guardar el tomo ya procesado para abrirlo al instante",
    save: "guardar .cbza",
    more: "Más controles",
    panelOf: (panel: number, panels: number) => `viñeta ${panel} / ${panels}`,
  },

  moods: { zen: "Zen", chill: "Chill", tense: "Tenso", war: "Guerra" },

  eta: (min: number, sec: number) =>
    min === 0 ? `${sec} s` : sec === 0 ? `${min} min` : `${min} min ${sec} s`,
};

export type Messages = typeof es;

const en: Messages = {
  meta: {
    title: "Mangaji — your manga, animated",
  },
  language: "Language",

  landing: {
    subtitle: "Manga reader",
    direction: "Read right to left and top to bottom, just like the printed original.",
    demoLabel:
      "Demo: the camera moves through a manga page panel by panel, right to left, and the dialogue appears when it's due.",
    tagline: "A CBZ and CBR reader. Everything happens in your browser.",
    headline: ["YOUR MANGA,", "ANIMATED"],
    headlineLabel: "Your manga, animated",
    intro:
      "Mangaji opens your CBZ files and, instead of leaving the whole page in front of you, walks through it: it frames each panel, travels to the next one and shows the dialogue right when it's due. Like watching the episode, except you set the pace.",
    bubbleIdle: "DROP YOUR VOLUME HERE",
    bubbleOpening: "OPENING…",
    bubbleDownloading: "DOWNLOADING…",
    choose: "CHOOSE FILE",
    formats: "Open a .cbz or .cbr. If you already processed it, the .cbza loads right away.",
    linkLabel: "OR PASTE A LINK",
    linkOpen: "OPEN",
    linkHelp: "Direct links, Dropbox or GitHub. Google Drive not yet.",
    downloaded: (pct: number, got: string, total: string) => `${pct}% · ${got} of ${total} MB`,
    downloadedUnknown: (got: string) => `${got} MB`,
    privacy:
      "The file is opened and processed in your browser. If it comes from a link, it downloads straight from where it lives, without going through any server of ours.",
    features: [
      {
        title: "SHOWS THE DIALOGUE",
        text: "Finds the speech balloons and shows each line right when it's due, with the pause the scene calls for.",
      },
      {
        title: "MOVES THE CAMERA",
        text: "Frames one panel at a time and glides to the next. Action scenes cut hard; quiet ones travel slowly.",
      },
      {
        title: "FINDS THE PANELS",
        text: "Analyzes the page and splits it panel by panel. Works out the reading order, even when the layout breaks into diagonals.",
      },
    ],
    madeBy: "Made by",
  },

  processing: {
    label: "PROCESSING",
    headlineOpening: "Opening",
    headlineModels: "Loading",
    headlinePage: "Reading the page",
    unpacking: "Unpacking",
    pageOf: (page: number, total: number) => `Page ${page} of ${total}`,
    remaining: (eta: string) => `${eta} left`,
    firstTime:
      "The first time, the detectors are downloaded — about 80 MB. After that the browser reuses them. On mobile data, Wi-Fi is a good idea.",
    footer: "All of this happens in your browser. The file never leaves your device.",
    logPage: (page: number, text: string) => `page ${page}: ${text}`,
  },

  notes: {
    unpacking: "unpacking the file",
    pageCount: (n: number) => `${n} pages`,
    gpu: "GPU accelerated",
    noGpu: "no GPU: this will take quite a bit longer",
    loadingPanels: "loading the panel detector",
    loadingDialogue: "loading the dialogue detector",
    findingPanels: "finding panels",
    liftingDialogue: (n: number) => `${n} panels · lifting the dialogue`,
  },

  problems: {
    noImages: "The file has no images in it.",
    notATome: (ext: string) => `That's a .${ext}, not a comic. Choose a .cbz, .cbr or .cbza file.`,
    linkEmpty: "Paste a link.",
    linkInvalid: "That doesn't look like a link.",
    linkDrive:
      "Google Drive links can't be opened from here yet: Drive doesn't let other pages download its files. Download it and pick it with the button, or share it through Dropbox.",
    linkBlocked:
      "That site doesn't let other pages download its files. Try a Dropbox link, or download it and pick it with the button.",
    offline: "You're offline.",
    linkMissing: "That link doesn't lead to any file: it may have been deleted.",
    linkPrivate: "That file is private. Share it so anyone with the link can view it.",
    linkHttp: (status: number) => `The site answered with an error (${status}).`,
    linkPage: "The link leads to a page, not to the file. Look for the direct download link.",
    unexpected: (detail: string) => `Couldn't open it: ${detail}`,
  },

  reader: {
    waiting: "getting the next page ready…",
    hintNext: ["tap here", "to go on"],
    hintCenter: ["center:", "controls"],
    hintBack: ["here to", "go back"],
  },

  toolbar: {
    goToPage: "Go to a page",
    prevPage: "Previous page (↑)",
    prevPanel: "Previous panel (→)",
    nextPanel: "Next panel (← or space)",
    nextPage: "Next page (↓)",
    zoomOut: "Zoom out (−)",
    fit: "Fit (f)",
    zoomIn: "Zoom in (+)",
    toggleMode: "Switch panel / page (v)",
    modePanel: "panel",
    modePage: "page",
    intensity: (mood: string) => `Intensity: ${mood}`,
    music: "Music (m)",
    musicOn: "♪ on",
    musicOff: "♪ off",
    volume: "Volume",
    volumeLabel: "Music volume",
    buildingTitle: "The remaining pages are being processed while you read",
    building: (done: number, total: number) => `processing ${done} / ${total}`,
    remaining: (eta: string) => `· ${eta} left`,
    saveTitle: "Save the processed volume so it opens instantly next time",
    save: "save .cbza",
    more: "More controls",
    panelOf: (panel: number, panels: number) => `panel ${panel} / ${panels}`,
  },

  moods: { zen: "Zen", chill: "Chill", tense: "Tense", war: "War" },

  eta: (min: number, sec: number) =>
    min === 0 ? `${sec} s` : sec === 0 ? `${min} min` : `${min} min ${sec} s`,
};

const ja: Messages = {
  meta: {
    title: "Mangaji — マンガが、動きだす",
  },
  language: "言語",

  landing: {
    subtitle: "マンガリーダー",
    direction: "右から左へ、上から下へ。紙の単行本と同じ順番で読みます。",
    demoLabel:
      "デモ：カメラがマンガのページを右から左へ、コマごとに進み、セリフはちょうどいいタイミングで現れます。",
    tagline: "CBZ・CBR 対応リーダー。すべてブラウザの中で。",
    headline: ["マンガが、", "動きだす。"],
    headlineLabel: "マンガが、動きだす。",
    intro:
      "Mangaji は CBZ ファイルを開いて、ページをそのまま見せるのではなく、読み進めていきます。コマをひとつずつ映し、次のコマへカメラが移動して、セリフはちょうどいいタイミングで現れます。アニメを観ているような体験で、テンポを決めるのはあなたです。",
    bubbleIdle: "ここにマンガを！",
    bubbleOpening: "開いています…",
    bubbleDownloading: "ダウンロード中…",
    choose: "ファイルを選ぶ",
    formats: ".cbz か .cbr を開いてください。一度処理した .cbza なら、すぐに読めます。",
    linkLabel: "またはリンクを貼り付け",
    linkOpen: "開く",
    linkHelp: "直接リンク、Dropbox、GitHub に対応。Google ドライブはまだ使えません。",
    downloaded: (pct: number, got: string, total: string) => `${pct}% · ${got} / ${total} MB`,
    downloadedUnknown: (got: string) => `${got} MB`,
    privacy:
      "ファイルはブラウザの中で開いて処理します。リンクの場合も、ファイルのある場所から直接ダウンロードされ、私たちのサーバーは通りません。",
    features: [
      {
        title: "セリフを見せる",
        text: "吹き出しを見つけて、ひとつひとつのセリフを、場面に合った間で表示します。",
      },
      {
        title: "カメラが動く",
        text: "コマをひとつずつ映して、次のコマへ移動します。アクションシーンではパッと切り替え、静かな場面ではゆっくり進みます。",
      },
      {
        title: "コマを見つける",
        text: "ページを解析して、コマごとに分けます。斜めに割られたレイアウトでも、読む順番を判断します。",
      },
    ],
    madeBy: "制作",
  },

  processing: {
    label: "処理中",
    headlineOpening: "開いています",
    headlineModels: "読み込み中",
    headlinePage: "ページを解析中",
    unpacking: "展開しています",
    pageOf: (page: number, total: number) => `${page} / ${total} ページ`,
    remaining: (eta: string) => `あと${eta}`,
    firstTime:
      "初回は検出モデル（約 80 MB）をダウンロードします。次回からはブラウザが再利用します。モバイルデータ通信の場合は Wi-Fi がおすすめです。",
    footer: "すべてブラウザの中で処理されます。ファイルがあなたの端末から出ることはありません。",
    logPage: (page: number, text: string) => `${page} ページ目: ${text}`,
  },

  notes: {
    unpacking: "ファイルを展開中",
    pageCount: (n: number) => `${n} ページ`,
    gpu: "GPU で高速処理",
    noGpu: "GPU なし：かなり時間がかかります",
    loadingPanels: "コマ検出モデルを読み込み中",
    loadingDialogue: "セリフ検出モデルを読み込み中",
    findingPanels: "コマを検出中",
    liftingDialogue: (n: number) => `${n} コマ · セリフを切り出し中`,
  },

  problems: {
    noImages: "ファイルに画像が入っていません。",
    notATome: (ext: string) =>
      `.${ext} ファイルはマンガではありません。.cbz、.cbr、.cbza のいずれかを選んでください。`,
    linkEmpty: "リンクを貼り付けてください。",
    linkInvalid: "リンクではないようです。",
    linkDrive:
      "Google ドライブのリンクはまだ開けません。ドライブは他のページからのダウンロードを許可していないためです。ダウンロードしてからボタンで選ぶか、Dropbox で共有してください。",
    linkBlocked:
      "そのサイトは他のページからのダウンロードを許可していません。Dropbox のリンクを試すか、ダウンロードしてからボタンで選んでください。",
    offline: "インターネットに接続されていません。",
    linkMissing: "そのリンクの先にファイルがありません。削除されたのかもしれません。",
    linkPrivate:
      "このファイルは非公開です。リンクを知っている人なら誰でも見られるように共有してください。",
    linkHttp: (status: number) => `サイトがエラーを返しました（${status}）。`,
    linkPage: "リンク先がファイルではなくページです。直接ダウンロードできるリンクを探してください。",
    unexpected: (detail: string) => `開けませんでした：${detail}`,
  },

  reader: {
    waiting: "次のページを準備中…",
    hintNext: ["ここをタップで", "次へ"],
    hintCenter: ["中央：", "操作メニュー"],
    hintBack: ["ここで", "戻る"],
  },

  toolbar: {
    goToPage: "ページへ移動",
    prevPage: "前のページ (↑)",
    prevPanel: "前のコマ (→)",
    nextPanel: "次のコマ (← またはスペース)",
    nextPage: "次のページ (↓)",
    zoomOut: "縮小 (−)",
    fit: "全体を表示 (f)",
    zoomIn: "拡大 (+)",
    toggleMode: "コマ／ページ切り替え (v)",
    modePanel: "コマ",
    modePage: "ページ",
    intensity: (mood: string) => `演出：${mood}`,
    music: "音楽 (m)",
    musicOn: "♪ オン",
    musicOff: "♪ オフ",
    volume: "音量",
    volumeLabel: "音楽の音量",
    buildingTitle: "読んでいる間に、残りのページを処理しています",
    building: (done: number, total: number) => `処理中 ${done} / ${total}`,
    remaining: (eta: string) => `· あと${eta}`,
    saveTitle: "処理済みの単行本を保存して、次回すぐに開けるようにします",
    save: ".cbza を保存",
    more: "その他の操作",
    panelOf: (panel: number, panels: number) => `コマ ${panel} / ${panels}`,
  },

  moods: { zen: "静か", chill: "まったり", tense: "緊迫", war: "激闘" },

  eta: (min: number, sec: number) =>
    min === 0 ? `${sec}秒` : sec === 0 ? `${min}分` : `${min}分${sec}秒`,
};

export const MESSAGES: Record<Lang, Messages> = { es, en, ja };

/** Un paso del procesamiento, dicho en el idioma de `t`. */
export function noteText(t: Messages, note: Note): string {
  switch (note.key) {
    case "pageCount":
      return t.notes.pageCount(note.n);
    case "liftingDialogue":
      return t.notes.liftingDialogue(note.n);
    default:
      return t.notes[note.key];
  }
}

/** Un error, explicado en el idioma de `t`. */
export function problemText(t: Messages, problem: Problem): string {
  switch (problem.code) {
    case "notATome":
      return t.problems.notATome(problem.ext);
    case "linkHttp":
      return t.problems.linkHttp(problem.status);
    case "unexpected":
      return t.problems.unexpected(problem.detail);
    default:
      return t.problems[problem.code];
  }
}

/** Segundos que faltan, redondeados antes de partirlos: si no, salía "2 min 60 s". */
export function etaText(t: Messages, seconds: number): string {
  const total = Math.max(1, Math.round(seconds));
  return t.eta(Math.floor(total / 60), total % 60);
}

/** El idioma pedido en la dirección, el elegido antes, o el del navegador. */
function detect(): Lang {
  const isLang = (v: string | null | undefined): v is Lang => v === "es" || v === "en" || v === "ja";

  const asked = new URLSearchParams(window.location.search).get("lang");
  if (isLang(asked)) return asked;

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLang(saved)) return saved;
  } catch {
    // Sin almacenamiento (navegación privada): se decide por el navegador.
  }

  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag.toLowerCase().split("-")[0];
    if (isLang(base)) return base;
  }
  // Ni español ni japonés: el inglés es el que más gente va a entender.
  return "en";
}

/**
 * La gótica japonesa entera, pedida solo en japonés.
 *
 * Google la sirve partida por rangos de caracteres, así que se bajan solo las partes con
 * los caracteres que la página usa. En español e inglés alcanza con los pocos glifos de la
 * portada, que ya vienen en una hoja mínima.
 */
const JA_FONT_URL =
  "https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700;900&display=swap";

function loadJapaneseFont(): void {
  if (document.getElementById("font-ja")) return;
  const link = document.createElement("link");
  link.id = "font-ja";
  link.rel = "stylesheet";
  link.href = JA_FONT_URL;
  // `require-corp` exige que un recurso de otro origen se pida con CORS.
  link.crossOrigin = "anonymous";
  document.head.appendChild(link);
}

type I18n = { lang: Lang; t: Messages; setLang: (lang: Lang) => void };

const I18nContext = createContext<I18n>({ lang: "es", t: es, setLang: () => {} });

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // Se arranca en español, que es lo que trae el HTML estático, y se ajusta al montar: así
  // el primer render coincide con el del servidor.
  const [lang, setLangState] = useState<Lang>("es");

  useEffect(() => setLangState(detect()), []);

  useEffect(() => {
    document.documentElement.lang = lang;
    if (lang === "ja") loadJapaneseFont();

    // Next escribe el título de la metadata después de hidratar y pisaría este: se vigila
    // el <head> y se lo repone. Cuando ya está puesto no hay cambio, así que no se encadena.
    const title = MESSAGES[lang].meta.title;
    const apply = () => {
      if (document.title !== title) document.title = title;
    };
    apply();
    const watch = new MutationObserver(apply);
    watch.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => watch.disconnect();
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Sin almacenamiento: vale para esta visita.
    }
    // Un `?lang=` en la dirección le gana a lo guardado: se saca para que al recargar
    // quede lo que se acaba de elegir.
    const url = new URL(window.location.href);
    if (url.searchParams.has("lang")) {
      url.searchParams.delete("lang");
      window.history.replaceState(window.history.state, "", url);
    }
  }, []);

  const value = useMemo(() => ({ lang, t: MESSAGES[lang], setLang }), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  return useContext(I18nContext);
}

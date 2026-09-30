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

  site: {
    how: "Cómo funciona",
    reader: "Abrir el lector",
    project: "Proyecto",
  },

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
    madeBy: "Hecho por Lawal, cooperativa de software.",
    howLink: "Cómo funciona, etapa por etapa",
    freeTitle: "Software libre",
    freeText:
      "Mangaji es software libre, con licencia MIT: podés usarlo, estudiarlo, modificarlo y compartirlo.",
    source: "Código fuente en GitHub",
    license: "Licencia MIT",
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
    downloadingModels: "bajando los detectores",
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

  how: {
    title: "Cómo funciona — Mangaji",
    headline: ["DEL ARCHIVO", "A LA ESCENA"],
    headlineLabel: "Del archivo a la escena",
    intro:
      "Mangaji no trae nada procesado de antemano. Cuando abrís un tomo, tu navegador lo lee página por página: encuentra las viñetas y los globos con dos redes neuronales, decide en qué orden se leen y arma la dirección de cada escena. Todo en tu dispositivo, sin servidores. Este es el recorrido de una página.",
    stepsLabel: "Las etapas",
    step: (n: number) => `Etapa ${n}`,
    steps: [
      {
        title: "Abrir el archivo",
        body: "Un CBZ es un ZIP con imágenes; un CBR, un RAR. El ZIP se abre con JavaScript. El RAR es un formato cerrado, así que para él corre libarchive compilado a WebAssembly. Las páginas se ordenan por nombre, respetando capítulos y numeración.",
        detail:
          "El trabajo pesado pasa en workers, hilos aparte del que dibuja la pantalla. Por eso se puede empezar a leer mientras el resto del tomo se sigue procesando.",
      },
      {
        title: "Preparar la página",
        body: "La red neuronal espera siempre lo mismo: un cuadrado de 1280 × 1280 píxeles. La página se achica sin deformarse, se ancla arriba a la izquierda y el resto se rellena de gris. Después se separa en sus tres colores, rojo, verde y azul: casi cinco millones de números entre 0 y 1.",
        detail:
          "El achique tiene que ser idéntico al del entrenamiento. Con el del navegador, una viñeta de Kingdom bajaba de 58 % de confianza a 9 % y desaparecía. Por eso se hace a mano, píxel por píxel, igual que OpenCV.",
      },
      {
        title: "Dos redes neuronales miran",
        body: "Dos modelos de la familia YOLO analizan la página. Uno, entrenado con el corpus Manga109, reconoce viñetas, globos y texto, y dibuja la silueta de cada uno. El otro está especializado en texto: a un globo al que el primero le da 0,2 % de confianza, este le da 66 %.",
        detail:
          "Corren con ONNX Runtime dentro del navegador: en la placa de video con WebGPU, o en el procesador con WebAssembly y varios hilos. Cada red devuelve hasta 300 candidatos con su confianza, y se quedan los que superan el umbral de su clase.",
      },
      {
        title: "De la mancha al polígono",
        body: "La silueta de cada detección sale de mezclar 32 «prototipos», imágenes borrosas que la red comparte entre todas, con 32 coeficientes propios de esa detección. Lo que supera el 50 % es parte de la figura. Esa mancha se limpia, se queda con su pieza más grande y se le traza el contorno.",
        detail:
          "Si el contorno es casi convexo —el 93 % o más del área de su envolvente—, se usa la envolvente: los cuadros de manga son de lados rectos. Una simplificación de Douglas-Peucker deja de unos 200 vértices unos 20.",
      },
      {
        title: "El orden de lectura",
        body: "El manga se lee de derecha a izquierda y de arriba abajo, pero las páginas rara vez son una grilla. Se cortan en filas y cada fila en columnas, una y otra vez, eligiendo cada vez el corte que menos viñetas rebana.",
        detail:
          "Un corte puede atravesar una viñeta mientras no le quite más del 15 %. Sin esa tolerancia, las páginas con bordes diagonales no se podrían separar. Es el algoritmo de Manga109 (Kovanen et al.).",
      },
      {
        title: "Levantar el diálogo",
        body: "Cada bloque de texto se separa del dibujo. Se estima el color del papel, la tinta pasa a ser transparencia y las letras quedan en una capa aparte, lista para aparecer cuando le toque. Después se borran de la página: dentro de un globo se tapan con papel liso; sobre el dibujo, con lo que rodea a cada trazo.",
        detail:
          "Antes de levantar nada se comprueba que parezca texto: que el fondo sea papel y que ninguna mancha se lleve casi toda la tinta, porque eso sería dibujo. Los bloques de un mismo globo se unen, y cada globo va a la viñeta con la que más se superpone.",
      },
      {
        title: "Dirigir cada viñeta",
        body: "Cada viñeta recibe una dirección: cómo entra la cámara, qué efecto dispara y cuánto dura. Sale de medirla: cuánta tinta tiene y qué forma. Una viñeta que ocupa más de media página se abre desde cerca; una muy ancha se recorre de derecha a izquierda; una muy alta, de arriba abajo.",
        detail:
          "Con más del 42 % de tinta es acción: la cámara entra de golpe y la pantalla tiembla; con más del 52 %, destello. Cada globo aparece a su turno y se queda entre 0,65 y 2,8 segundos, según cuánto texto tiene.",
      },
      {
        title: "Guardarlo en un .cbza",
        body: "Lo procesado se puede guardar. Un .cbza es un ZIP con las páginas limpias en WebP, cada globo como imagen aparte y un manifiesto JSON con las viñetas, el orden y la dirección. La próxima vez abre al instante, sin volver a pasar por las redes.",
        detail: "El manifiesto sigue un esquema validado y se puede corregir a mano: ningún detector acierta siempre.",
      },
    ],
    scene: {
      panel: "viñeta",
      balloon: "globo",
      text: "texto",
      layer: "capa de diálogo",
      pages: "páginas",
      camera: "cámara",
      reveal: "globo",
      read: "lectura",
      hold: "pausa",
      ink: "tinta",
    },
    closingTitle: "PROBALO CON TU TOMO",
    closing: "Todo esto pasa en tu dispositivo, en segundos por página.",
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

  site: {
    how: "How it works",
    reader: "Open the reader",
    project: "Project",
  },

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
    madeBy: "Made by Lawal, a software cooperative.",
    howLink: "How it works, stage by stage",
    freeTitle: "Free software",
    freeText: "Mangaji is free software under the MIT license: you can use, study, change and share it.",
    source: "Source code on GitHub",
    license: "MIT license",
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
    downloadingModels: "downloading the detectors",
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

  how: {
    title: "How it works — Mangaji",
    headline: ["FROM FILE", "TO SCENE"],
    headlineLabel: "From file to scene",
    intro:
      "Mangaji ships nothing preprocessed. When you open a volume, your browser reads it page by page: it finds the panels and balloons with two neural networks, works out the reading order and builds the direction of every scene. All on your device, with no servers. This is the journey of one page.",
    stepsLabel: "The stages",
    step: (n: number) => `Stage ${n}`,
    steps: [
      {
        title: "Opening the file",
        body: "A CBZ is a ZIP full of images; a CBR is a RAR. The ZIP is opened with JavaScript. RAR is a closed format, so for it libarchive runs compiled to WebAssembly. Pages are sorted by name, keeping chapters and numbering in order.",
        detail:
          "The heavy lifting happens in workers, threads apart from the one that draws the screen. That's why you can start reading while the rest of the volume is still being processed.",
      },
      {
        title: "Preparing the page",
        body: "The neural network always expects the same thing: a 1280 × 1280 pixel square. The page is shrunk without distortion, anchored to the top left, and the rest is filled with gray. Then it's split into its three colors, red, green and blue: almost five million numbers between 0 and 1.",
        detail:
          "The shrinking has to match training exactly. With the browser's own, a Kingdom panel dropped from 58% confidence to 9% and vanished. So it's done by hand, pixel by pixel, the same way OpenCV does it.",
      },
      {
        title: "Two neural networks look",
        body: "Two YOLO-family models analyze the page. One, trained on the Manga109 corpus, recognizes panels, balloons and text, and outlines each of them. The other specializes in text: a balloon the first one gives 0.2% confidence, this one gives 66%.",
        detail:
          "They run with ONNX Runtime inside the browser: on the graphics card with WebGPU, or on the processor with multi-threaded WebAssembly. Each network returns up to 300 candidates with their confidence, and the ones above their class threshold are kept.",
      },
      {
        title: "From blob to polygon",
        body: "Each detection's outline comes from mixing 32 “prototypes” — blurry images the network shares across all detections — with 32 coefficients of its own. Whatever goes over 50% belongs to the shape. That blob is cleaned up, reduced to its largest piece, and traced.",
        detail:
          "If the outline is nearly convex — 93% or more of its hull's area — the hull is used instead: manga panels have straight sides. A Douglas-Peucker simplification turns about 200 vertices into about 20.",
      },
      {
        title: "The reading order",
        body: "Manga reads right to left and top to bottom, but pages are rarely a grid. They're cut into rows and each row into columns, over and over, each time picking the cut that slices the fewest panels.",
        detail:
          "A cut may run through a panel as long as it takes no more than 15% of it. Without that tolerance, pages with diagonal borders couldn't be split. It's the Manga109 algorithm (Kovanen et al.).",
      },
      {
        title: "Lifting the dialogue",
        body: "Every text block is separated from the art. The paper color is estimated, ink becomes transparency, and the letters move to a layer of their own, ready to appear when it's their turn. Then they're erased from the page: inside a balloon they're covered with plain paper; over the art, with whatever surrounds each stroke.",
        detail:
          "Before lifting anything, it checks that it looks like text: the background has to be paper, and no single blob can hold almost all the ink — that would be drawing. Blocks from the same balloon are merged, and each balloon goes to the panel it overlaps most.",
      },
      {
        title: "Directing each panel",
        body: "Every panel gets a direction: how the camera comes in, which effect fires and how long it lasts. It comes from measuring the panel: how much ink it holds and what shape it has. A panel taking over half the page opens from up close; a very wide one is swept right to left; a very tall one, top to bottom.",
        detail:
          "Over 42% ink means action: the camera punches in and the screen shakes; over 52%, a flash. Each balloon appears in turn and stays between 0.65 and 2.8 seconds, depending on how much text it has.",
      },
      {
        title: "Saving it as .cbza",
        body: "What was processed can be saved. A .cbza is a ZIP with the clean pages as WebP, each balloon as its own image, and a JSON manifest with the panels, the order and the direction. Next time it opens instantly, without going through the networks again.",
        detail: "The manifest follows a validated schema and can be fixed by hand: no detector gets it right every time.",
      },
    ],
    scene: {
      panel: "panel",
      balloon: "balloon",
      text: "text",
      layer: "dialogue layer",
      pages: "pages",
      camera: "camera",
      reveal: "balloon",
      read: "reading",
      hold: "pause",
      ink: "ink",
    },
    closingTitle: "TRY IT WITH YOUR VOLUME",
    closing: "All of this happens on your device, in seconds per page.",
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

  site: {
    how: "しくみ",
    reader: "リーダーを開く",
    project: "プロジェクト",
  },

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
    madeBy: "ソフトウェア協同組合 Lawal が制作しました。",
    howLink: "しくみをステップごとに見る",
    freeTitle: "フリーソフトウェア",
    freeText:
      "Mangaji は MIT ライセンスのフリーソフトウェアです。自由に使い、調べ、改変し、共有できます。",
    source: "GitHub でソースコードを見る",
    license: "MIT ライセンス",
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
    downloadingModels: "検出モデルをダウンロード中",
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

  how: {
    title: "しくみ — Mangaji",
    headline: ["ファイルから、", "シーンへ。"],
    headlineLabel: "ファイルから、シーンへ。",
    intro:
      "Mangaji は、あらかじめ処理したデータを持っていません。単行本を開くと、ブラウザが 1 ページずつ読み込みます。2 つのニューラルネットワークでコマと吹き出しを見つけ、読む順番を決め、シーンごとの演出を組み立てます。すべてあなたの端末の中で、サーバーは使いません。ここでは、1 ページがたどる道のりを紹介します。",
    stepsLabel: "ステップ",
    step: (n: number) => `ステップ ${n}`,
    steps: [
      {
        title: "ファイルを開く",
        body: "CBZ は画像の入った ZIP、CBR は RAR です。ZIP は JavaScript で開きます。RAR は仕様が公開されていない形式なので、WebAssembly にコンパイルした libarchive を使います。ページはファイル名で並べ、章や番号の順番を守ります。",
        detail:
          "重い処理はワーカーで行います。画面を描くスレッドとは別のスレッドです。そのため、残りのページを処理している間にも読み始められます。",
      },
      {
        title: "ページを準備する",
        body: "ニューラルネットワークが受け取るのは、いつも 1280 × 1280 ピクセルの正方形です。ページは形を崩さずに縮小し、左上にそろえ、残りを灰色で埋めます。そのあと赤・緑・青の 3 色に分けます。0 から 1 までの数値が、約 500 万個になります。",
        detail:
          "縮小のしかたは、学習のときとまったく同じでなければなりません。ブラウザ標準の縮小では、『キングダム』のあるコマの信頼度が 58% から 9% に下がり、検出されなくなりました。そのため OpenCV と同じ方法で、1 ピクセルずつ計算しています。",
      },
      {
        title: "2 つのネットワークが見る",
        body: "YOLO 系の 2 つのモデルがページを解析します。ひとつは Manga109 コーパスで学習したモデルで、コマ・吹き出し・文字を見つけ、それぞれの輪郭を描きます。もうひとつは文字専用です。最初のモデルが 0.2% の信頼度しか出さない吹き出しにも、こちらは 66% を出します。",
        detail:
          "どちらも ONNX Runtime でブラウザの中で動きます。WebGPU ならグラフィックボードで、そうでなければ WebAssembly のマルチスレッドで CPU を使います。各ネットワークは信頼度つきの候補を最大 300 個返し、クラスごとのしきい値を超えたものだけを残します。",
      },
      {
        title: "かたまりから多角形へ",
        body: "検出ごとの輪郭は、すべての検出で共有される 32 枚のぼやけた画像「プロトタイプ」を、その検出に固有の 32 個の係数で混ぜ合わせて作ります。50% を超えた部分が形になります。そのかたまりを整え、いちばん大きな部分だけを残して、輪郭をなぞります。",
        detail:
          "輪郭がほぼ凸形（凸包の面積の 93% 以上）なら、凸包を使います。マンガのコマは辺がまっすぐだからです。最後に Douglas-Peucker 法で、約 200 個の頂点を約 20 個に減らします。",
      },
      {
        title: "読む順番",
        body: "マンガは右から左、上から下へ読みますが、ページがきれいな格子になっていることはまれです。ページを行に分け、各行を列に分ける、という分割をくり返します。毎回、切ってしまうコマがいちばん少ない線を選びます。",
        detail:
          "分割線は、コマの 15% までなら横切ってもかまいません。この許容がないと、斜めの枠線のページは分けられません。Manga109 のアルゴリズム（Kovanen ほか）です。",
      },
      {
        title: "セリフを切り出す",
        body: "文字のかたまりを、絵から切り離します。紙の色を推定し、インクを透明度に変えて、文字だけを別のレイヤーに移します。出番が来たら表示するためです。そのあとページから文字を消します。吹き出しの中は無地の紙の色で、絵の上では線のまわりの色で埋めます。",
        detail:
          "切り出す前に、本当に文字かどうかを確かめます。背景が紙であること、そしてひとつのかたまりがインクのほとんどを占めていないこと（それは絵です）。同じ吹き出しの文字はまとめ、いちばん重なるコマに割り当てます。",
      },
      {
        title: "コマごとの演出",
        body: "コマごとに演出が決まります。カメラの入り方、効果、表示時間です。どれもコマを測った結果から決まります。インクの量と、コマの形です。ページの半分以上を占めるコマは寄りから引き、とても横長なら右から左へ、とても縦長なら上から下へカメラが動きます。",
        detail:
          "インクが 42% を超えるとアクション。カメラが一気に寄り、画面が揺れます。52% を超えるとフラッシュ。吹き出しは順番に現れ、文字の量に応じて 0.65 秒から 2.8 秒表示されます。",
      },
      {
        title: ".cbza に保存する",
        body: "処理した結果は保存できます。.cbza は ZIP ファイルで、文字を消したページ（WebP）、吹き出しごとの画像、そしてコマ・順番・演出を記録した JSON のマニフェストが入っています。次からはネットワークを通さず、すぐに開けます。",
        detail: "マニフェストは検証済みのスキーマに従っていて、手で修正することもできます。完璧な検出器はないからです。",
      },
    ],
    scene: {
      panel: "コマ",
      balloon: "吹き出し",
      text: "文字",
      layer: "セリフのレイヤー",
      pages: "ページ",
      camera: "カメラ",
      reveal: "吹き出し",
      read: "表示",
      hold: "間",
      ink: "インク",
    },
    closingTitle: "あなたのマンガで試そう",
    closing: "これがすべて、あなたの端末の中で、1 ページ数秒で行われます。",
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

export function I18nProvider({
  children,
  title = (t) => t.meta.title,
}: {
  children: React.ReactNode;
  /** El título de la pestaña de esta página, en cada idioma. */
  title?: (t: Messages) => string;
}) {
  // Se arranca en español, que es lo que trae el HTML estático, y se ajusta al montar: así
  // el primer render coincide con el del servidor.
  const [lang, setLangState] = useState<Lang>("es");

  useEffect(() => setLangState(detect()), []);

  useEffect(() => {
    document.documentElement.lang = lang;
    if (lang === "ja") loadJapaneseFont();

    // Next escribe el título de la metadata después de hidratar y pisaría este: se vigila
    // el <head> y se lo repone. Cuando ya está puesto no hay cambio, así que no se encadena.
    const wanted = title(MESSAGES[lang]);
    const apply = () => {
      if (document.title !== wanted) document.title = wanted;
    };
    apply();
    const watch = new MutationObserver(apply);
    watch.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => watch.disconnect();
  }, [lang, title]);

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

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
    title: "Mangaji — tu manga, animeizado | Lector de CBZ y CBR online",
  },
  language: "Idioma",

  site: {
    how: "Cómo funciona",
    reader: "Abrir el lector",
    project: "Proyecto",
    legal: "Términos y privacidad",
    stats: "Contamos las visitas de forma anónima con GoatCounter, sin cookies. Tus tomos no salen de tu dispositivo.",
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
    sampleAsk: "¿No tenés un tomo a mano?",
    sampleTry: "Probar con un ejemplo",
    sampleCreditShort: "Episodio 1 de «Give My Regards to Black Jack», de Shuho Sato, liberado por su autor para uso libre.",
    linkToggle: "¿Lo tenés en un link?",
    sampleCredit: "Es el episodio 1 de «Give My Regards to Black Jack» (Burakku Jakku ni Yoroshiku), de Shuho Sato. En 2012 el autor liberó la obra entera: cualquiera puede leerla, copiarla, traducirla y compartirla sin pedir permiso ni pagar nada. Él conserva sus derechos de autor.",
    rights: "Abrí solo archivos que tengas derecho a leer.",
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
    hintPage: "deslizá ↑↓ para saltar de página",
    hintBack: ["acá para", "volver"],
  },

  how: {
    title: "Cómo funciona — Mangaji",
    headline: ["DEL ARCHIVO", "A LA ESCENA"],
    headlineLabel: "Del archivo a la escena",
    intro:
      "Mangaji no usa ningún servidor: cuando abrís un tomo, todo el trabajo lo hace tu navegador, página por página. Primero encuentra las viñetas y los globos de diálogo con inteligencia artificial; después decide en qué orden se leen y prepara cómo mostrar cada una. Estos son los ocho pasos por los que pasa cada página.",
    stepsLabel: "Las etapas",
    step: (n: number) => `Etapa ${n}`,
    steps: [
      {
        title: "Abrir el archivo",
        body: "Un archivo .cbz es una carpeta comprimida en formato ZIP con las páginas adentro; un .cbr es lo mismo, pero en formato RAR. Mangaji los descomprime en tu navegador y ordena las páginas por nombre, respetando capítulos y numeración.",
        detail:
          "El RAR es un formato cerrado, así que para abrirlo se usa libarchive, una biblioteca compilada a WebAssembly para que corra dentro del navegador. El trabajo pesado va en segundo plano: por eso podés empezar a leer mientras el resto del tomo se sigue procesando.",
      },
      {
        title: "Preparar la imagen",
        body: "La inteligencia artificial siempre recibe una imagen del mismo tamaño: un cuadrado de 1280 × 1280 píxeles. La página se achica sin deformarse hasta entrar en ese cuadrado, y el espacio que sobra se rellena de gris. Después la imagen se convierte en números: una tabla por color —rojo, verde y azul—, casi cinco millones de valores en total.",
        detail:
          "Este paso tiene que hacerse igual que cuando se entrenó el modelo. El navegador achica las imágenes a su manera, y con esa diferencia mínima una viñeta de Kingdom bajaba de 58 % a 9 % de confianza y dejaba de detectarse. Por eso el achique se calcula a mano, píxel por píxel, con el mismo método del entrenamiento.",
      },
      {
        title: "Buscar viñetas y globos",
        body: "Dos redes neuronales —modelos de inteligencia artificial entrenados con miles de páginas de manga— analizan la imagen. La primera encuentra viñetas, globos y texto, y marca la forma de cada uno. La segunda está especializada en texto y encuentra diálogos que a la primera se le escapan.",
        detail:
          "Cada red propone hasta 300 candidatos con un porcentaje de confianza, y se quedan los que superan un mínimo. Si una zona grande de la página queda sin ninguna viñeta, se acepta una candidata con menos confianza: pasa con las viñetas que llegan al borde de la hoja sin marco. Las redes corren en la placa de video si el dispositivo lo permite, o en el procesador.",
      },
      {
        title: "Dibujar el contorno",
        body: "La red no entrega el contorno de cada viñeta ya dibujado: entrega una mancha borrosa que indica dónde está. Esa mancha se convierte en un polígono de pocos lados. Se decide qué píxeles forman parte de la viñeta, se limpian los bordes y se traza el contorno.",
        detail:
          "La mancha sale de mezclar 32 imágenes base que la red usa para todas sus detecciones; cada viñeta tiene su propia mezcla. Los píxeles que superan el 50 % pasan a ser parte de la viñeta. Como los cuadros de manga tienen lados rectos, el contorno se endereza y se simplifica: de unos 200 puntos quedan unos 20.",
      },
      {
        title: "Decidir el orden",
        body: "El manga se lee de derecha a izquierda y de arriba abajo, pero las viñetas rara vez forman una grilla prolija, así que el orden no siempre es obvio. Mangaji corta la página en filas, después corta cada fila en columnas, y repite hasta que cada viñeta queda sola. En cada paso elige el corte que menos viñetas atraviesa.",
        detail:
          "Un corte puede pasar por encima de una viñeta si le toca menos del 15 % de su superficie. Esa tolerancia es la que permite separar páginas con bordes en diagonal, muy comunes en las escenas de acción. El método viene del proyecto de investigación Manga109.",
      },
      {
        title: "Separar el texto",
        body: "Para que cada globo aparezca en su momento, el texto se separa del dibujo. Las letras se recortan y se guardan aparte, como una capa transparente. Después se borran de la página: dentro de un globo se pintan del color del papel, y fuera de un globo se rellenan con lo que las rodea.",
        detail:
          "Antes de recortar se comprueba que sea texto de verdad: el fondo tiene que ser papel y la tinta tiene que estar repartida en letras, no concentrada en una sola mancha, que sería un dibujo. Si un globo tiene varios bloques de texto se unen, y cada globo se asigna a la viñeta con la que más se superpone.",
      },
      {
        title: "Dirigir cada viñeta",
        body: "Cada viñeta recibe su propia puesta en escena: cómo entra la cámara, si hay algún efecto y cuánto tiempo se muestra. Todo sale de medir la viñeta: cuánta tinta tiene y qué forma. Por ejemplo, una viñeta muy ancha se recorre de derecha a izquierda, y una muy alta, de arriba abajo.",
        detail:
          "Mucha tinta suele ser acción: con más del 42 % la cámara entra de golpe y la pantalla tiembla; con más del 52 %, hay un destello. Una viñeta que ocupa más de media página arranca de cerca y se abre. Los globos aparecen de a uno, y cada uno queda solo entre 0,25 y 1,6 segundos antes del siguiente, según cuánto texto tiene.",
      },
      {
        title: "Guardar el resultado",
        body: "Todo lo procesado se puede guardar en un archivo .cbza. Adentro van las páginas sin texto, cada globo como imagen aparte y un archivo que describe las viñetas, el orden y la puesta en escena. La próxima vez carga al instante, sin volver a pasar por la inteligencia artificial.",
        detail:
          "Ese archivo descriptivo —el manifiesto, en formato JSON— sigue un esquema fijo y se puede corregir a mano. Sirve para arreglar lo que la detección no acertó: ningún detector acierta siempre.",
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
    title: "Mangaji — your manga, animated | Online CBZ & CBR reader",
  },
  language: "Language",

  site: {
    how: "How it works",
    reader: "Open the reader",
    project: "Project",
    legal: "Terms and privacy",
    stats: "We count visits anonymously with GoatCounter, without cookies. Your volumes never leave your device.",
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
    sampleAsk: "No volume at hand?",
    sampleTry: "Try a sample",
    sampleCreditShort: "Episode 1 of “Give My Regards to Black Jack” by Shuho Sato, released by its author for free use.",
    linkToggle: "Got it as a link?",
    sampleCredit: "It's episode 1 of “Give My Regards to Black Jack” (Burakku Jakku ni Yoroshiku) by Shuho Sato. In 2012 the author released the whole work: anyone can read, copy, translate and share it without asking permission or paying anything. He keeps his copyright.",
    rights: "Only open files you have the right to read.",
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
    hintPage: "swipe ↑↓ to jump pages",
    hintBack: ["here to", "go back"],
  },

  how: {
    title: "How it works — Mangaji",
    headline: ["FROM FILE", "TO SCENE"],
    headlineLabel: "From file to scene",
    intro:
      "Mangaji uses no servers: when you open a volume, your browser does all the work, page by page. First it finds the panels and speech balloons with artificial intelligence; then it works out the order they're read in and how to show each one. These are the eight steps every page goes through.",
    stepsLabel: "The stages",
    step: (n: number) => `Stage ${n}`,
    steps: [
      {
        title: "Opening the file",
        body: "A .cbz file is a folder compressed as a ZIP, with the pages inside; a .cbr is the same thing in RAR format. Mangaji unpacks it in your browser and sorts the pages by name, keeping chapters and numbering in order.",
        detail:
          "RAR is a closed format, so it's opened with libarchive, a library compiled to WebAssembly so it can run inside the browser. The heavy lifting happens in the background: that's why you can start reading while the rest of the volume is still being processed.",
      },
      {
        title: "Preparing the image",
        body: "The AI always receives an image of the same size: a 1280 × 1280 pixel square. The page is shrunk without distortion until it fits in that square, and the leftover space is filled with gray. Then the image is turned into numbers: one table per color — red, green and blue — almost five million values in total.",
        detail:
          "This step has to match how the model was trained. Browsers shrink images their own way, and with that tiny difference a Kingdom panel dropped from 58% to 9% confidence and stopped being detected. So the shrinking is calculated by hand, pixel by pixel, with the same method used in training.",
      },
      {
        title: "Finding panels and balloons",
        body: "Two neural networks — AI models trained on thousands of manga pages — analyze the image. The first finds panels, balloons and text, and marks the shape of each one. The second specializes in text and finds dialogue the first one misses.",
        detail:
          "Each network proposes up to 300 candidates with a confidence score, and the ones above a minimum are kept. If a large area of the page ends up with no panel, a lower-confidence candidate is accepted: this happens with panels that run to the edge of the page without a border. The networks run on the graphics card when the device allows it, or on the processor.",
      },
      {
        title: "Drawing the outline",
        body: "The network doesn't hand over each panel's outline ready-made: it gives a blurry blob showing where the panel is. That blob is turned into a polygon with few sides. It decides which pixels belong to the panel, cleans up the edges and traces the outline.",
        detail:
          "The blob comes from mixing 32 base images the network uses for all its detections; each panel has its own mix. Pixels above 50% become part of the panel. Since manga panels have straight sides, the outline is straightened and simplified: about 200 points become about 20.",
      },
      {
        title: "Deciding the order",
        body: "Manga reads right to left and top to bottom, but panels rarely form a neat grid, so the order isn't always obvious. Mangaji cuts the page into rows, then each row into columns, and repeats until every panel stands alone. At each step it picks the cut that crosses the fewest panels.",
        detail:
          "A cut may run over a panel as long as it touches less than 15% of it. That tolerance is what makes it possible to split pages with diagonal borders, very common in action scenes. The method comes from the Manga109 research project.",
      },
      {
        title: "Separating the text",
        body: "So each balloon can appear at the right moment, the text is separated from the art. The letters are cut out and stored apart, as a transparent layer. Then they're erased from the page: inside a balloon they're painted with the paper color, and outside a balloon they're filled with whatever surrounds them.",
        detail:
          "Before cutting anything out, it checks that it really is text: the background has to be paper, and the ink has to be spread across letters rather than concentrated in one blob, which would be a drawing. If a balloon has several blocks of text they're merged, and each balloon goes to the panel it overlaps most.",
      },
      {
        title: "Directing each panel",
        body: "Every panel gets its own staging: how the camera comes in, whether there's an effect, and how long it stays on screen. It all comes from measuring the panel: how much ink it has and what shape it is. For example, a very wide panel is swept right to left, and a very tall one, top to bottom.",
        detail:
          "Lots of ink usually means action: above 42% the camera punches in and the screen shakes; above 52%, there's a flash. A panel taking up more than half the page starts up close and pulls back. Balloons appear one at a time, and each stays alone between 0.25 and 1.6 seconds before the next, depending on how much text it has.",
      },
      {
        title: "Saving the result",
        body: "Everything processed can be saved as a .cbza file. Inside are the pages without text, each balloon as a separate image, and a file describing the panels, the order and the staging. Next time it loads instantly, without going through the AI again.",
        detail:
          "That description file — the manifest, in JSON format — follows a fixed schema and can be corrected by hand. It's there to fix whatever the detection got wrong: no detector gets it right every time.",
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
    title: "Mangaji — マンガが、動きだす｜CBZ・CBR オンラインリーダー",
  },
  language: "言語",

  site: {
    how: "しくみ",
    reader: "リーダーを開く",
    project: "プロジェクト",
    legal: "利用規約とプライバシー",
    stats: "アクセス数は GoatCounter で匿名に集計しています（クッキーは使いません）。単行本のファイルが端末から出ることはありません。",
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
    sampleAsk: "手元に単行本がない？",
    sampleTry: "サンプルで試す",
    sampleCreditShort: "佐藤秀峰『ブラックジャックによろしく』第 1 話。作者により二次利用フリー。",
    linkToggle: "リンクで開く？",
    sampleCredit: "佐藤秀峰『ブラックジャックによろしく』第 1 話（英語版）です。2012 年、作者は作品全体の二次利用をフリーにしました。許可や支払いなしで、誰でも読んだり、複製・翻訳・共有したりできます。著作権は作者が保持しています。",
    rights: "読む権利のあるファイルだけを開いてください。",
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
    hintPage: "上下にスワイプでページ移動",
    hintBack: ["ここで", "戻る"],
  },

  how: {
    title: "しくみ — Mangaji",
    headline: ["ファイルから、", "シーンへ。"],
    headlineLabel: "ファイルから、シーンへ。",
    intro:
      "Mangaji はサーバーを使いません。単行本を開くと、あなたのブラウザが 1 ページずつすべての処理を行います。まず AI でコマと吹き出しを見つけ、次に読む順番と、それぞれの見せ方を決めます。ここでは、1 ページが通る 8 つのステップを紹介します。",
    stepsLabel: "ステップ",
    step: (n: number) => `ステップ ${n}`,
    steps: [
      {
        title: "ファイルを開く",
        body: ".cbz は、ページの画像をまとめて ZIP 形式で圧縮したファイルです。.cbr は同じものを RAR 形式にしたものです。Mangaji はこれをブラウザの中で展開し、章や番号の順番を守ってページをファイル名順に並べます。",
        detail:
          "RAR は仕様が公開されていない形式なので、ブラウザの中で動くように WebAssembly にしたライブラリ「libarchive」で開きます。重い処理は裏で行うので、残りのページを処理している間にも読み始められます。",
      },
      {
        title: "画像を準備する",
        body: "AI が受け取る画像は、いつも同じ大きさ、1280 × 1280 ピクセルの正方形です。ページは形を崩さずにこの正方形に収まるまで縮小し、余った部分は灰色で埋めます。そのあと画像を数値に変えます。赤・緑・青の色ごとに表を作り、合計で約 500 万個の数値になります。",
        detail:
          "この処理は、モデルを学習させたときとまったく同じ方法で行う必要があります。ブラウザ独自の縮小では、その小さな違いだけで『キングダム』のあるコマの信頼度が 58% から 9% に下がり、検出されなくなりました。そのため、学習時と同じ方法で 1 ピクセルずつ計算しています。",
      },
      {
        title: "コマと吹き出しを探す",
        body: "何千ページものマンガで学習した 2 つの AI モデル（ニューラルネットワーク）が画像を解析します。1 つ目はコマ・吹き出し・文字を見つけ、それぞれの形をとらえます。2 つ目は文字専用で、1 つ目が見落としたセリフを見つけます。",
        detail:
          "それぞれのモデルは信頼度つきの候補を最大 300 個出し、基準を超えたものだけを残します。ページの広い範囲にコマがひとつもない場合は、信頼度の低い候補も採用します。枠線がなく紙の端まで描かれたコマで起こることです。AI は、端末が対応していればグラフィックボードで、そうでなければ CPU で動きます。",
      },
      {
        title: "輪郭を描く",
        body: "AI はコマの輪郭をそのまま描いて返すわけではなく、コマのある場所をぼんやりしたかたまりで示します。そのかたまりを、少ない辺の多角形に変えます。どのピクセルがコマに含まれるかを決め、ふちを整えて、輪郭をなぞります。",
        detail:
          "かたまりは、AI がすべての検出で共通して使う 32 枚の基本画像を混ぜて作られ、コマごとに混ぜ方が違います。50% を超えたピクセルがコマの一部になります。マンガのコマは辺がまっすぐなので、輪郭をまっすぐに整えて単純にします。約 200 個の点が約 20 個になります。",
      },
      {
        title: "順番を決める",
        body: "マンガは右から左、上から下へ読みますが、コマがきれいな格子に並んでいることはまれなので、順番はいつも明らかとは限りません。Mangaji はページを行に分け、各行を列に分けることを、コマがひとつずつに分かれるまでくり返します。そのたびに、横切るコマがいちばん少ない線を選びます。",
        detail:
          "分ける線は、コマの面積の 15% 未満なら横切ってもかまいません。この余裕があるからこそ、アクションシーンに多い斜めの枠線のページも分けられます。この方法は研究プロジェクト Manga109 によるものです。",
      },
      {
        title: "文字を切り離す",
        body: "吹き出しをちょうどいいタイミングで表示するために、文字を絵から切り離します。文字を切り抜いて、透明なレイヤーとして別に保存します。そのあとページから文字を消します。吹き出しの中は紙の色で塗り、吹き出しの外ではまわりの絵で埋めます。",
        detail:
          "切り抜く前に、本当に文字かどうかを確かめます。背景が紙であること、そしてインクがひとつのかたまりに集中せず文字として散らばっていること（集中していれば絵です）。ひとつの吹き出しに文字のかたまりが複数あればまとめ、吹き出しはいちばん重なるコマに割り当てます。",
      },
      {
        title: "コマごとに演出する",
        body: "コマごとに演出が決まります。カメラの入り方、効果の有無、表示する時間です。どれもコマを測った結果、つまりインクの量と形から決まります。たとえば、とても横長のコマは右から左へ、とても縦長のコマは上から下へカメラが動きます。",
        detail:
          "インクが多いのはたいていアクションです。42% を超えるとカメラが一気に寄って画面が揺れ、52% を超えるとフラッシュが入ります。ページの半分以上を占めるコマは、寄りから始まって引いていきます。吹き出しはひとつずつ現れ、文字の量に応じて 0.25 秒から 1.6 秒で次に進みます。",
      },
      {
        title: "結果を保存する",
        body: "処理した結果は .cbza ファイルに保存できます。中身は、文字を消したページ、吹き出しごとの画像、そしてコマ・順番・演出を記したファイルです。次に開くときは AI を通さないので、すぐに読めます。",
        detail:
          "この記述ファイル（JSON 形式のマニフェスト）は決まった形式に沿っていて、手で直すこともできます。検出が外れたところを直すためです。完璧な検出器はありません。",
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

/**
 * El idioma del sitio. Vive en el layout, no en cada página: así sobrevive a la navegación
 * entre páginas. Cuando cada página tenía el suyo, al cambiar de página arrancaba otra vez
 * en español y se veía el cambio.
 */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  // Se arranca en español, que es lo que trae el HTML estático, y se ajusta al montar: así
  // el primer render coincide con el del servidor.
  const [lang, setLangState] = useState<Lang>("es");

  useEffect(() => setLangState(detect()), []);

  useEffect(() => {
    document.documentElement.lang = lang;
    if (lang === "ja") loadJapaneseFont();
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Sin almacenamiento: vale para esta visita.
    }
    // El idioma elegido queda en la dirección: así el link que se comparte abre en ese
    // idioma, y al recargar se mantiene (el `?lang=` le gana a lo guardado).
    const url = new URL(window.location.href);
    url.searchParams.set("lang", next);
    window.history.replaceState(window.history.state, "", url);
  }, []);

  const value = useMemo(() => ({ lang, t: MESSAGES[lang], setLang }), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** De qué página es el título de la pestaña. */
const TITLES = {
  home: (t: Messages) => t.meta.title,
  how: (t: Messages) => t.how.title,
  legal: (t: Messages) => `${t.site.legal} — Mangaji`,
} as const;

/**
 * El título de la pestaña de una página, en el idioma puesto.
 *
 * Next escribe el título de la metadata después de hidratar y al navegar, y pisaría este:
 * se vigila el <head> y se lo repone. Cuando ya está puesto no hay cambio, así que no se
 * encadena.
 */
export function DocumentTitle({ page }: { page: keyof typeof TITLES }) {
  const { t } = useI18n();
  useEffect(() => {
    const wanted = TITLES[page](t);
    const apply = () => {
      if (document.title !== wanted) document.title = wanted;
    };
    apply();
    const watch = new MutationObserver(apply);
    watch.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => watch.disconnect();
  }, [page, t]);
  return null;
}

export function useI18n(): I18n {
  return useContext(I18nContext);
}

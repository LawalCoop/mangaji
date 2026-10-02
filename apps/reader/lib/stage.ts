import { Application, BlurFilter, Container, Graphics, Sprite, Texture } from "pixi.js";
import { Camera, type Transform } from "./camera";
import type { Frame, Rect } from "./types";

/**
 * La superficie de render. Dibuja un encuadre —un recorte de una página— aplicando la
 * transformación de la cámara al contenedor del mundo.
 *
 * El foco sobre la viñeta activa se compone en un canvas y se sube como textura, en vez de
 * resolverse con máscaras y filtros del motor: enmascarar con un objeto filtrado rompe el
 * recorte, y crear texturas por viñeta dejaba al renderer usando texturas ya liberadas.
 * Componer a mano es predecible y se paga una vez por encuadre, no por cuadro.
 */

/** Texturas vivas alrededor de la página actual. Cada página son ~4 MP en VRAM. */
const TEXTURE_LIMIT = 5;

/**
 * Tono del papel de una página, tomado de sus bordes.
 *
 * Se muestrea una miniatura en vez de la página entera: para elegir un color de fondo sobra
 * y cuesta una fracción de milisegundo.
 *
 * Del marco exterior se toma un percentil alto y no la mediana: en una página cargada de
 * tinta la mediana se contamina con el dibujo y devuelve un gris, que contra el margen
 * blanco del escaneo se ve como un corte. El papel es la parte clara del borde.
 */
function paperColor(bitmap: ImageBitmap): number {
  const size = 24;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, size, size);

  const { data } = ctx.getImageData(0, 0, size, size);
  const edge: number[][] = [[], [], []];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (x > 1 && x < size - 2 && y > 1 && y < size - 2) continue;
      const i = (y * size + x) * 4;
      edge[0].push(data[i]);
      edge[1].push(data[i + 1]);
      edge[2].push(data[i + 2]);
    }
  }

  const paper = (v: number[]) =>
    v.sort((a, b) => a - b)[Math.floor(v.length * 0.82)] ?? 255;
  const [r, g, b] = edge.map(paper);
  return (r << 16) | (g << 8) | b;
}
/** A qué fracción de la resolución se arman el desenfoque y la máscara del foco. */
const FOCUS_SCALE = 4;
/**
 * Cuánto se atenúa el diálogo de las viñetas que no son la activa.
 *
 * Va entero. A media opacidad el texto ya leído quedaba flotando dentro de su globo como una
 * mancha gris con forma de letras, que es exactamente el aspecto de un borrado a medio hacer
 * —y se confunde con eso—. De la atenuación ya se encarga el foco, que difumina y ensombrece
 * la página alrededor de la viñeta: el diálogo tiene que acompañar a la hoja, no ir aparte.
 */
const OFF_PANEL_DIALOGUE_ALPHA = 1;
/**
 * Desenfoque con el que entra un bloque de diálogo, en píxeles de la página.
 *
 * El globo se ve vacío hasta que le toca, y el texto entra apareciendo y enfocándose a la
 * vez. Se probó dejar el texto puesto desde el principio y solo enfocarlo, pero el globo
 * en blanco resultó preferible: se lee más limpio y marca mejor el turno de cada diálogo.
 */
const DIALOGUE_ENTRY_BLUR = 5;

export class Stage {
  readonly camera = new Camera();
  /**
   * Cuánto se apaga la página fuera de la viñeta activa. En 0 se muestra tal cual, sin
   * componer nada.
   */
  focusStrength = 0.11;
  /** Radio del desenfoque del entorno, en píxeles de la página. */
  focusBlur = 3;
  /**
   * Ancho de la franja donde la viñeta nítida se funde con el entorno, en píxeles de la
   * página. Generoso a propósito: que se vea parte de la viñeta vecina no molesta, y una
   * transición larga disimula el efecto mejor que una angosta.
   */
  focusFeather = 180;

  #app: Application;
  #world = new Container();
  #art = new Sprite();
  #dialogue = new Container();
  #sprites = new Map<string, Sprite>();
  /** Desenfoque de entrada de cada bloque de diálogo. */
  #blurs = new Map<string, BlurFilter>();
  /** Medida original de cada sprite, para animar sin acumular error. */
  #rects = new Map<string, Rect>();
  #textures = new Map<number, Texture>();
  #bitmaps = new Map<number, ImageBitmap>();
  #page = -1;

  /**
   * El foco se compone en capas: debajo, la página nítida, que se sube una vez; encima, el
   * entorno desenfocado y apagado con un hueco de borde suave donde está la viñeta. Esa capa
   * va a un cuarto de resolución, así que por viñeta se rehace y se sube algo chico. Antes se componía la página entera en canvas 2D y se subía de nuevo en
   * cada cambio de viñeta: decenas de milisegundos en un celular, justo al arrancar la
   * cámara, que es donde se notaba el tirón.
   */
  #blurred = new Sprite();
  /** La capa de encima: el entorno desenfocado, con el hueco de la viñeta, a un cuarto. */
  #overlayCanvas: HTMLCanvasElement | null = null;
  #overlayTexture: Texture | null = null;
  /** Página desenfocada a un cuarto de resolución, por página y ajuste. */
  #blurredPages = new Map<number, { key: string; canvas: HTMLCanvasElement }>();
  #focusKey = "";

  /** Capa de efectos, en coordenadas de pantalla. */
  #fx = new Container();
  #flash = new Graphics();
  #streaks = new Graphics();
  /** Invierte lo que hay debajo: el impact frame del anime. */
  #invert = new Graphics();
  /** Telón de apertura: cubre la pantalla y se abre sobre la primera página. */
  #curtain = new Graphics();
  #curtainState: { left: number; total: number; color: number } | null = null;
  #fxState: { kind: "flash" | "speedlines"; left: number; total: number; power: number } | null =
    null;

  private constructor(app: Application) {
    this.#app = app;
    this.#world.addChild(this.#art, this.#blurred, this.#dialogue);
    this.#blurred.visible = false;
    // Los efectos van fuera del mundo: se dibujan sobre la pantalla y no los arrastra la
    // cámara, que es lo que hace que un destello se sienta como un golpe y no como algo
    // pegado a la página.
    this.#invert.blendMode = "difference";
    this.#invert.visible = false;
    this.#fx.addChild(this.#streaks, this.#invert, this.#flash, this.#curtain);
    app.stage.addChild(this.#world, this.#fx);
  }

  static async create(canvas: HTMLCanvasElement): Promise<Stage> {
    const app = new Application();
    await app.init({
      canvas,
      resizeTo: canvas.parentElement ?? window,
      background: "#0a0a0a",
      // Sin antialias: solo se dibujan imágenes, y en el celular el multisampling cuesta.
      antialias: false,
      autoDensity: true,
      // Tope en 2: los celulares vienen con 3, que son más del doble de píxeles por cuadro
      // —con el desenfoque del foco encima— sin diferencia que se vea a esa distancia.
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      preference: "webgl",
    });
    return new Stage(app);
  }

  get viewport() {
    return { w: this.#app.screen.width, h: this.#app.screen.height };
  }

  /** Corre `fn` en cada frame de render, con el delta en milisegundos. */
  onTick(fn: (dtMs: number) => void): () => void {
    const cb = () => fn(this.#app.ticker.deltaMS);
    this.#app.ticker.add(cb);
    return () => this.#app.ticker.remove(cb);
  }

  /**
   * Muestra un encuadre. La textura solo se rehace cuando cambia la página o la viñeta
   * enfocada, así avanzar dentro de la misma página no re-sube el arte entero.
   */
  show(frame: Frame, bitmap: ImageBitmap): void {
    if (frame.page !== this.#page) {
      this.#bitmaps.set(frame.page, bitmap);
      this.#page = frame.page;
      this.#evict(frame.page);
      // El fondo toma el tono del papel: cuando el encuadre se sale de la hoja, en vez de
      // un corte contra el negro parece que la página siguiera.
      this.#app.renderer.background.color = paperColor(bitmap);
    }

    const focused =
      this.focusStrength > 0 && Boolean(frame.polygon && frame.polygon.length >= 3);

    this.#art.texture = this.#texture(frame.page, bitmap);
    if (focused) {
      const key = `${frame.page}:${frame.id}:${this.focusStrength}:${this.focusBlur}:${this.focusFeather}`;
      if (key !== this.#focusKey) {
        this.#composeFocus(frame, bitmap);
        this.#focusKey = key;
      }
    } else {
      this.#focusKey = "";
      this.#blurred.visible = false;
    }

    this.#placeDialogue(frame);
  }

  /** Aplica la cámara. Llamar después de `camera.update()`. */
  render(t: Transform = this.camera.transform): void {
    this.#world.position.set(t.x, t.y);
    this.#world.scale.set(t.scale);
  }

  /** Rehace el foco cuando cambian sus ajustes sin cambiar de encuadre. */
  refocus(frame: Frame): void {
    this.#focusKey = "";
    const bitmap = this.#bitmaps.get(frame.page);
    if (bitmap) this.show(frame, bitmap);
  }

  /**
   * Coloca el diálogo de la página, oculto.
   *
   * El arte base ya no lo tiene —el pipeline lo levantó y dejó el globo vacío—, así que hasta
   * que le toca no se dibuja nada y el globo se ve en blanco. Se probó dejarlo puesto y
   * desenfocado, para que se viera que hay texto sin poder leerlo, y el globo vacío quedó
   * mejor: el desenfoque se lee como suciedad, no como algo que falta.
   */
  setDialogue(entries: { id: string; bitmap: ImageBitmap; rect: Rect }[]): void {
    this.#dialogue.removeChildren().forEach((child) => child.destroy());
    this.#sprites.clear();

    this.#blurs.clear();
    this.#rects.clear();
    for (const entry of entries) {
      const sprite = new Sprite(Texture.from(entry.bitmap));
      sprite.position.set(entry.rect.x, entry.rect.y);
      sprite.setSize(entry.rect.w, entry.rect.h);
      sprite.alpha = 0; // el globo se ve vacío hasta que le toca
      this.#dialogue.addChild(sprite);
      this.#sprites.set(entry.id, sprite);
      this.#rects.set(entry.id, entry.rect);
      this.#blurs.set(entry.id, new BlurFilter({ strength: DIALOGUE_ENTRY_BLUR, quality: 2 }));
    }
  }

  /**
   * Dispara un efecto sobre la pantalla.
   *
   * Uno por vez: el que entra reemplaza al anterior. Superponerlos es lo que convierte un
   * golpe en un revoltijo.
   */
  playFx(kind: string, power: number, ms: number): void {
    if (kind === "shake") {
      this.camera.shake(power, ms);
      return;
    }
    if (kind === "flash" || kind === "speedlines") {
      this.#fxState = { kind, left: ms, total: Math.max(ms, 1), power };
    }
  }

  /**
   * Cubre la pantalla y la despeja en `ms`.
   *
   * Se usa al abrir: la primera página no aparece de golpe, se descubre mientras la cámara
   * se abre sobre ella.
   */
  openCurtain(ms: number, color = 0x101014): void {
    this.#curtainState = { left: ms, total: Math.max(ms, 1), color };
  }

  /** Avanza los efectos en curso. Devuelve si queda alguno vivo. */
  updateFx(dtMs: number): boolean {
    this.#flash.clear();
    this.#streaks.clear();
    this.#curtain.clear();

    // El telón corre por su cuenta: se abre aunque no haya ningún efecto en curso.
    const curtain = this.#curtainState;
    if (curtain) {
      curtain.left -= dtMs;
      if (curtain.left <= 0) {
        this.#curtainState = null;
      } else {
        const { w, h } = this.viewport;
        // Se despeja al principio despacio y al final rápido: deja ver la portada entrando.
        const alpha = Math.pow(curtain.left / curtain.total, 0.7);
        this.#curtain.rect(0, 0, w, h).fill({ color: curtain.color, alpha });
      }
    }

    const state = this.#fxState;
    if (!state) {
      this.#invert.visible = false;
      return this.#curtainState !== null;
    }

    state.left -= dtMs;
    if (state.left <= 0) {
      this.#fxState = null;
      return false;
    }

    const { w, h } = this.viewport;
    const t = 1 - state.left / state.total;

    if (state.kind === "flash") {
      // Arranca invirtiendo la imagen unos pocos cuadros —el impact frame del anime— y
      // recién después destella. Invertir marca el golpe mucho más que iluminar.
      if (t < 0.12) {
        this.#invert.visible = true;
        this.#invert.clear().rect(0, 0, w, h).fill({ color: 0xffffff, alpha: 1 });
        return true;
      }
      this.#invert.visible = false;
      const u = (t - 0.12) / 0.88;
      const alpha = state.power * (u < 0.12 ? u / 0.12 : Math.pow(1 - (u - 0.12) / 0.88, 2));
      this.#flash.rect(0, 0, w, h).fill({ color: 0xffffff, alpha });
      return true;
    }

    this.#drawSpeedlines(w, h, state.power, t);
    return true;
  }

  /**
   * Líneas de velocidad radiales: la firma visual del anime para el impacto.
   *
   * Salen del centro hacia los bordes dejando un hueco limpio en el medio, para que el
   * dibujo se siga leyendo. El hueco se abre a medida que el efecto avanza, y eso es lo que
   * da la sensación de que algo estalla hacia afuera.
   */
  #drawSpeedlines(w: number, h: number, power: number, t: number): void {
    const cx = w / 2;
    const cy = h / 2;
    const reach = Math.hypot(w, h) / 2;
    const hole = reach * (0.28 + 0.34 * t);
    const alpha = (t < 0.15 ? t / 0.15 : Math.pow(1 - (t - 0.15) / 0.85, 1.6)) * 0.9;
    const count = Math.round(70 + 130 * power);

    for (let i = 0; i < count; i++) {
      // Distribución fija por índice: las mismas líneas cada cuadro, sin hervir.
      const seed = Math.sin(i * 12.9898) * 43758.5453;
      const jitter = seed - Math.floor(seed);
      const angle = (i / count) * Math.PI * 2 + jitter * 0.05;
      const start = hole * (0.85 + jitter * 0.3);
      const end = reach * (1.05 + jitter * 0.25);
      const width = 1 + jitter * (2 + 3 * power);

      this.#streaks
        .moveTo(cx + Math.cos(angle) * start, cy + Math.sin(angle) * start)
        .lineTo(cx + Math.cos(angle) * end, cy + Math.sin(angle) * end)
        .stroke({ width, color: jitter > 0.5 ? 0x000000 : 0xffffff, alpha });
    }
  }

  /** Muestra un bloque de diálogo. `progress` de 0 a 1 anima su entrada. */
  revealDialogue(id: string, progress: number): void {
    const sprite = this.#sprites.get(id);
    if (!sprite) return;
    const t = Math.min(Math.max(progress, 0), 1);
    const full = sprite.label === "off" ? OFF_PANEL_DIALOGUE_ALPHA : 1;
    sprite.alpha = full * t;

    // Entra apenas más grande y se asienta: le da peso, como si el globo se plantara.
    // Se calcula siempre desde la medida original, para que no se acumule cuadro a cuadro.
    const rect = this.#rects.get(id);
    if (rect) {
      const bounce = 1 + 0.07 * Math.sin(Math.PI * t) * (1 - t);
      sprite.setSize(rect.w * bounce, rect.h * bounce);
      sprite.position.set(
        rect.x - (rect.w * (bounce - 1)) / 2,
        rect.y - (rect.h * (bounce - 1)) / 2,
      );
    }

    const blur = this.#blurs.get(id);
    if (!blur) return;
    if (t >= 1) {
      sprite.filters = []; // ya nítido: sin filtro no se paga nada por él
      return;
    }
    blur.strength = DIALOGUE_ENTRY_BLUR * (1 - t) ** 1.6;
    sprite.filters = [blur];
  }

  destroy(): void {
    for (const [, tex] of this.#textures) tex.destroy(true);
    this.#textures.clear();
    this.#bitmaps.clear();
    this.#art.texture = Texture.EMPTY;
    this.#blurredPages.clear();
    this.#overlayTexture?.destroy(true);
    this.#overlayTexture = null;
    this.#app.destroy(true, { children: true });
  }

  /** Arma el foco de una viñeta: el entorno desenfocado, con el hueco de su silueta. */
  #composeFocus(frame: Frame, bitmap: ImageBitmap): void {
    const { width, height } = bitmap;
    const sw = Math.max(1, Math.round(width / FOCUS_SCALE));
    const sh = Math.max(1, Math.round(height / FOCUS_SCALE));

    // La página desenfocada, una vez por página: está borrosa de todos modos, así que a un
    // cuarto se ve igual.
    const blurKey = `${this.focusBlur}`;
    let page = this.#blurredPages.get(frame.page);
    if (!page || page.key !== blurKey) {
      const canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh;
      const cx = canvas.getContext("2d")!;
      cx.filter = `blur(${this.focusBlur / FOCUS_SCALE}px)`;
      cx.drawImage(bitmap, 0, 0, sw, sh);
      page = { key: blurKey, canvas };
      this.#blurredPages.set(frame.page, page);
    }

    let overlay = this.#overlayCanvas;
    if (!overlay || overlay.width !== sw || overlay.height !== sh) {
      overlay = document.createElement("canvas");
      overlay.width = sw;
      overlay.height = sh;
      this.#overlayCanvas = overlay;
      this.#overlayTexture?.destroy(true);
      this.#overlayTexture = Texture.from(overlay);
    }
    const ox = overlay.getContext("2d")!;
    ox.setTransform(1, 0, 0, 1, 0, 0);
    ox.globalCompositeOperation = "source-over";
    ox.filter = "none";
    ox.clearRect(0, 0, sw, sh);
    ox.drawImage(page.canvas, 0, 0);

    // El hueco: la silueta dilatada y con borde suave. Trazar con grosor además de rellenar
    // dilata la silueta, y así el desvanecido cae por fuera de la viñeta en vez de
    // repartirse a ambos lados de su borde.
    const feather = this.focusFeather / FOCUS_SCALE;
    ox.globalCompositeOperation = "destination-out";
    ox.setTransform(1 / FOCUS_SCALE, 0, 0, 1 / FOCUS_SCALE, 0, 0);
    ox.filter = feather > 0 ? `blur(${feather / 3}px)` : "none";
    ox.fillStyle = "#fff";
    ox.strokeStyle = "#fff";
    ox.lineJoin = "round";
    ox.lineWidth = feather * FOCUS_SCALE;
    ox.beginPath();
    frame.polygon!.forEach(([x, y], i) => (i === 0 ? ox.moveTo(x, y) : ox.lineTo(x, y)));
    ox.closePath();
    ox.fill();
    if (feather > 0) ox.stroke();
    ox.filter = "none";
    ox.globalCompositeOperation = "source-over";
    this.#overlayTexture!.source.update();

    // Apagado con un tinte: equivale a la capa negra semitransparente de antes.
    this.#blurred.texture = this.#overlayTexture!;
    this.#blurred.setSize(width, height);
    const level = Math.round(255 * (1 - this.focusStrength));
    this.#blurred.tint = (level << 16) | (level << 8) | level;
    this.#blurred.visible = true;
  }

  /**
   * Marca qué diálogo pertenece a la viñeta activa. El de las otras se atenúa para que no
   * compita, ya que la página que lo rodea está difuminada.
   */
  #placeDialogue(frame: Frame): void {
    const mine = new Set((frame.layers ?? []).map((l) => l.id));
    for (const [id, sprite] of this.#sprites) {
      const own = mine.has(id);
      sprite.label = own ? "own" : "off";
      if (sprite.alpha > 0) sprite.alpha = own ? 1 : OFF_PANEL_DIALOGUE_ALPHA;
    }
  }

  #texture(page: number, bitmap: ImageBitmap): Texture {
    const cached = this.#textures.get(page);
    if (cached) return cached;
    const tex = Texture.from(bitmap);
    this.#textures.set(page, tex);
    return tex;
  }

  /**
   * Libera texturas lejanas. Destruye también el ImageBitmap de origen: para entonces ya
   * está subido a la GPU, y el ArchiveSource tolera que se lo cierren por debajo.
   */
  #evict(page: number): void {
    for (const [p, tex] of this.#textures) {
      if (Math.abs(p - page) > TEXTURE_LIMIT) {
        tex.destroy(true);
        this.#textures.delete(p);
      }
    }
    for (const p of this.#bitmaps.keys()) {
      if (Math.abs(p - page) > TEXTURE_LIMIT) this.#bitmaps.delete(p);
    }
    for (const p of this.#blurredPages.keys()) {
      if (Math.abs(p - page) > TEXTURE_LIMIT) this.#blurredPages.delete(p);
    }
  }
}

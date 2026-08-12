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
/** Cuánto se atenúa el diálogo de las viñetas que no son la activa. */
const OFF_PANEL_DIALOGUE_ALPHA = 0.5;
/**
 * Desenfoque del diálogo que todavía no fue revelado, en píxeles de la página.
 *
 * El texto está desde el principio, ilegible, y lo único que pasa al revelarlo es que toma
 * foco. Así el globo nunca se ve vacío: un globo en blanco que de golpe se llena se lee
 * como un corte, y encima delata el truco de haber sacado el texto del arte.
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
  #textures = new Map<number, Texture>();
  #bitmaps = new Map<number, ImageBitmap>();
  #page = -1;

  /** Lienzos de composición del foco, creados una vez y reescritos en cada encuadre. */
  #focusCanvas: HTMLCanvasElement | null = null;
  #sharpCanvas: HTMLCanvasElement | null = null;
  #maskCanvas: HTMLCanvasElement | null = null;
  #focusTexture: Texture | null = null;
  #focusKey = "";

  /** Capa de efectos, en coordenadas de pantalla. */
  #fx = new Container();
  #flash = new Graphics();
  #streaks = new Graphics();
  #fxState: { kind: "flash" | "speedlines"; left: number; total: number; power: number } | null =
    null;

  private constructor(app: Application) {
    this.#app = app;
    this.#world.addChild(this.#art, this.#dialogue);
    // Los efectos van fuera del mundo: se dibujan sobre la pantalla y no los arrastra la
    // cámara, que es lo que hace que un destello se sienta como un golpe y no como algo
    // pegado a la página.
    this.#fx.addChild(this.#streaks, this.#flash);
    app.stage.addChild(this.#world, this.#fx);
  }

  static async create(canvas: HTMLCanvasElement): Promise<Stage> {
    const app = new Application();
    await app.init({
      canvas,
      resizeTo: canvas.parentElement ?? window,
      background: "#0a0a0a",
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
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
    }

    const focused =
      this.focusStrength > 0 && Boolean(frame.polygon && frame.polygon.length >= 3);

    if (focused) {
      const key = `${frame.page}:${frame.id}:${this.focusStrength}:${this.focusBlur}`;
      if (key !== this.#focusKey) {
        this.#composeFocus(frame, bitmap);
        this.#focusKey = key;
      }
      this.#art.texture = this.#focusTexture!;
    } else {
      this.#focusKey = "";
      this.#art.texture = this.#texture(frame.page, bitmap);
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
   * Coloca el diálogo de la página, desenfocado.
   *
   * El arte base ya no lo tiene —el pipeline lo levantó y dejó el globo vacío—, así que el
   * sprite ocupa ese hueco desde el principio: se ve que hay texto pero no se lee, y
   * revelarlo es enfocarlo. El globo nunca queda en blanco.
   */
  setDialogue(entries: { id: string; bitmap: ImageBitmap; rect: Rect }[]): void {
    this.#dialogue.removeChildren().forEach((child) => child.destroy());
    this.#sprites.clear();

    this.#blurs.clear();
    for (const entry of entries) {
      const sprite = new Sprite(Texture.from(entry.bitmap));
      sprite.position.set(entry.rect.x, entry.rect.y);
      sprite.setSize(entry.rect.w, entry.rect.h);
      this.#dialogue.addChild(sprite);
      this.#sprites.set(entry.id, sprite);

      // Nace puesto pero ilegible: revelar es enfocar, no hacer aparecer.
      const blur = new BlurFilter({ strength: DIALOGUE_ENTRY_BLUR, quality: 2 });
      this.#blurs.set(entry.id, blur);
      sprite.filters = [blur];
      sprite.alpha = 1;
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

  /** Avanza los efectos en curso. Devuelve si queda alguno vivo. */
  updateFx(dtMs: number): boolean {
    const state = this.#fxState;
    this.#flash.clear();
    this.#streaks.clear();
    if (!state) return false;

    state.left -= dtMs;
    if (state.left <= 0) {
      this.#fxState = null;
      return false;
    }

    const { w, h } = this.viewport;
    const t = 1 - state.left / state.total;

    if (state.kind === "flash") {
      // Sube de golpe y baja: un destello que se enciende despacio no golpea.
      const alpha = state.power * (t < 0.18 ? t / 0.18 : Math.pow(1 - (t - 0.18) / 0.82, 2));
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
    sprite.alpha = sprite.label === "off" ? OFF_PANEL_DIALOGUE_ALPHA : 1;

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
    this.#focusTexture?.destroy(true);
    this.#focusTexture = null;
    this.#app.destroy(true, { children: true });
  }

  /**
   * Compone la página con la viñeta activa nítida y el resto difuminado y apagado.
   *
   * Se dibuja el fondo con desenfoque y luego encima la copia nítida recortada a la
   * silueta con borde difuso, usando `destination-in` sobre un lienzo auxiliar. Todo en
   * canvas 2D: no intervienen máscaras ni filtros del motor.
   */
  #composeFocus(frame: Frame, bitmap: ImageBitmap): void {
    const { width, height } = bitmap;
    const focus = this.#ensureCanvas("focus", width, height);
    const sharp = this.#ensureCanvas("sharp", width, height);

    const fx = focus.getContext("2d")!;
    fx.setTransform(1, 0, 0, 1, 0, 0);
    fx.clearRect(0, 0, width, height);
    fx.filter = `blur(${this.focusBlur}px)`;
    fx.drawImage(bitmap, 0, 0);
    fx.filter = "none";
    fx.fillStyle = `rgba(0,0,0,${this.focusStrength})`;
    fx.fillRect(0, 0, width, height);

    const sx = sharp.getContext("2d")!;
    sx.setTransform(1, 0, 0, 1, 0, 0);
    sx.globalCompositeOperation = "source-over";
    sx.clearRect(0, 0, width, height);
    sx.filter = "none";
    sx.drawImage(bitmap, 0, 0);

    // La silueta se arma aparte y se aplica de una sola vez.
    //
    // Con `destination-in` cada operación de dibujo recorta, así que rellenar y después
    // trazar dejaba solo el anillo del trazo: la viñeta salía nítida en los bordes y
    // borrosa en el centro, justo al revés.
    const mask = this.#ensureCanvas("mask", width, height);
    const mx = mask.getContext("2d")!;
    const feather = this.focusFeather;
    mx.setTransform(1, 0, 0, 1, 0, 0);
    mx.globalCompositeOperation = "source-over";
    mx.clearRect(0, 0, width, height);
    // Trazar con grosor además de rellenar dilata la silueta, y así el desvanecido cae por
    // fuera de la viñeta en vez de repartirse a ambos lados de su borde.
    mx.filter = feather > 0 ? `blur(${feather / 3}px)` : "none";
    mx.fillStyle = "#fff";
    mx.strokeStyle = "#fff";
    mx.lineJoin = "round";
    mx.lineWidth = feather;
    mx.beginPath();
    frame.polygon!.forEach(([x, y], i) => (i === 0 ? mx.moveTo(x, y) : mx.lineTo(x, y)));
    mx.closePath();
    mx.fill();
    if (feather > 0) mx.stroke();
    mx.filter = "none";

    sx.globalCompositeOperation = "destination-in";
    sx.drawImage(mask, 0, 0);
    sx.globalCompositeOperation = "source-over";

    fx.drawImage(sharp, 0, 0);

    if (!this.#focusTexture) {
      this.#focusTexture = Texture.from(focus);
    }
    this.#focusTexture.source.update();
  }

  #ensureCanvas(
    which: "focus" | "sharp" | "mask",
    width: number,
    height: number,
  ): HTMLCanvasElement {
    const current =
      which === "focus" ? this.#focusCanvas : which === "sharp" ? this.#sharpCanvas : this.#maskCanvas;
    if (current && current.width === width && current.height === height) return current;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    if (which === "focus") {
      this.#focusCanvas = canvas;
      // La textura queda ligada al lienzo: si el lienzo cambia, hay que rehacerla.
      this.#focusTexture?.destroy(true);
      this.#focusTexture = null;
    } else if (which === "sharp") {
      this.#sharpCanvas = canvas;
    } else {
      this.#maskCanvas = canvas;
    }
    return canvas;
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
  }
}

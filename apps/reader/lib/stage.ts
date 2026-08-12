import { Application, Container, Sprite, Texture } from "pixi.js";
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
  /** Posición final de cada sprite, para animar desde un pequeño desplazamiento. */
  #rests = new Map<string, number>();
  #textures = new Map<number, Texture>();
  #bitmaps = new Map<number, ImageBitmap>();
  #page = -1;

  /** Lienzos de composición del foco, creados una vez y reescritos en cada encuadre. */
  #focusCanvas: HTMLCanvasElement | null = null;
  #sharpCanvas: HTMLCanvasElement | null = null;
  #focusTexture: Texture | null = null;
  #focusKey = "";

  private constructor(app: Application) {
    this.#app = app;
    this.#world.addChild(this.#art, this.#dialogue);
    app.stage.addChild(this.#world);
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
   * Coloca el diálogo de la página, oculto. El arte base ya no lo tiene: el pipeline lo
   * levantó y dejó el globo vacío, así que hasta que se revele el globo se ve en blanco.
   */
  setDialogue(entries: { id: string; bitmap: ImageBitmap; rect: Rect }[]): void {
    this.#dialogue.removeChildren().forEach((child) => child.destroy());
    this.#sprites.clear();
    this.#rests.clear();

    for (const entry of entries) {
      const sprite = new Sprite(Texture.from(entry.bitmap));
      sprite.position.set(entry.rect.x, entry.rect.y);
      sprite.setSize(entry.rect.w, entry.rect.h);
      sprite.alpha = 0;
      this.#dialogue.addChild(sprite);
      this.#sprites.set(entry.id, sprite);
      this.#rests.set(entry.id, entry.rect.y);
    }
  }

  /** Muestra un bloque de diálogo. `progress` de 0 a 1 anima su aparición. */
  revealDialogue(id: string, progress: number): void {
    const sprite = this.#sprites.get(id);
    if (!sprite) return;
    const t = Math.min(Math.max(progress, 0), 1);
    sprite.alpha = t * (sprite.label === "off" ? OFF_PANEL_DIALOGUE_ALPHA : 1);
    // Un desplazamiento mínimo hacia arriba: da la sensación de que el globo "habla" en
    // vez de que una imagen aparezca de la nada.
    sprite.y = this.#rests.get(id)! + (1 - t) * 6;
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

    // Recorte con borde difuso: se conserva solo lo que cae bajo la silueta.
    //
    // La silueta se dilata trazándola con grosor antes de difuminarla. Sin eso el degradado
    // queda centrado en el borde de la viñeta y la mitad de la transición cae adentro, o
    // sea que la propia viñeta se ve algo desenfocada en los bordes. Dilatada, la viñeta
    // queda entera nítida y el desvanecido ocurre por fuera.
    const feather = this.focusFeather;
    sx.globalCompositeOperation = "destination-in";
    sx.filter = feather > 0 ? `blur(${feather / 3}px)` : "none";
    sx.fillStyle = "#fff";
    sx.strokeStyle = "#fff";
    sx.lineJoin = "round";
    sx.lineWidth = feather;
    sx.beginPath();
    frame.polygon!.forEach(([x, y], i) => (i === 0 ? sx.moveTo(x, y) : sx.lineTo(x, y)));
    sx.closePath();
    sx.fill();
    if (feather > 0) sx.stroke();
    sx.globalCompositeOperation = "source-over";
    sx.filter = "none";

    fx.drawImage(sharp, 0, 0);

    if (!this.#focusTexture) {
      this.#focusTexture = Texture.from(focus);
    }
    this.#focusTexture.source.update();
  }

  #ensureCanvas(which: "focus" | "sharp", width: number, height: number): HTMLCanvasElement {
    const current = which === "focus" ? this.#focusCanvas : this.#sharpCanvas;
    if (current && current.width === width && current.height === height) return current;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    if (which === "focus") {
      this.#focusCanvas = canvas;
      // La textura queda ligada al lienzo: si el lienzo cambia, hay que rehacerla.
      this.#focusTexture?.destroy(true);
      this.#focusTexture = null;
    } else {
      this.#sharpCanvas = canvas;
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

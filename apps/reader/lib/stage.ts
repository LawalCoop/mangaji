import { Application, BlurFilter, Container, Graphics, Sprite, Texture, TilingSprite, UPDATE_PRIORITY } from "pixi.js";
import { Camera, type Transform } from "./camera";
import type { Frame, Rect } from "./types";
import { directionOf, outOfReach, type Direction } from "./memory";
import { CPU_2D } from "./canvas";

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
/** A cuánto de la página se arma la máscara de la viñeta enfocada. */
const HOLE_SCALE = 16;
/** Cuánto de la página (su lado mayor) llega la luz alrededor de la viñeta, con la sombra. */
const SHADOW_REACH = 0.12;
/** Cuánto sale la capa de sombra fuera de la página, en proporción a su lado mayor. */
const SHADOW_PAD = 0.8;
/** Con el mosaico de fondo, más: la sombra tiene que cubrir todo lo que se ve alrededor. */
const SHADOW_PAD_BACKDROP = 1.4;
/** A cuánto de la página se arma la sombra: es un degradé suave, alcanza con muy poco. */
const SHADE_SCALE = 16;

/**
 * El mosaico del fondo, en píxeles de pantalla: alto de cada tapa, separación y celda de la
 * trama; y la tapa en sí, apagada para quedar de fondo (brillo y contraste), con juntas
 * oscuras entre una y otra.
 */
const MOSAIC = { height: 420, gap: 14, cell: 5, brightness: 0.6, contrast: 0.85, joint: 0.78 };

/**
 * La tapa como fondo: en blanco y negro, apagada, con una trama de puntos suave encima que
 * le da textura de imprenta sin taparla.
 */
function screened(cover: ImageBitmap, w: number, h: number, cell: number): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ox = out.getContext("2d", CPU_2D)!;
  ox.filter = `grayscale(1) brightness(${MOSAIC.brightness}) contrast(${MOSAIC.contrast})`;
  ox.drawImage(cover, 0, 0, w, h);
  ox.filter = "none";
  // La trama: puntos negros apenas visibles, en grilla a 45°.
  ox.fillStyle = "rgba(0, 0, 0, 0.22)";
  for (let r = 0, y = cell / 2; y < h; r++, y += cell) {
    for (let x = r % 2 ? cell / 2 : 0; x < w; x += cell) {
      ox.beginPath();
      ox.arc(x, y, cell * 0.28, 0, Math.PI * 2);
      ox.fill();
    }
  }
  return out;
}

/** Un color hacia el negro, en la proporción dada. */
function darken(color: number, amount: number): number {
  const k = 1 - amount;
  const r = Math.round(((color >> 16) & 255) * k);
  const g = Math.round(((color >> 8) & 255) * k);
  const b = Math.round((color & 255) * k);
  return (r << 16) | (g << 8) | b;
}
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

/** El hueco de las líneas de velocidad, como parte del radio: con cuánto empieza y cuánto crece. */
const SPEEDLINE_HOLE = { from: 0.28, grow: 0.34 };

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
  /**
   * Además del desenfoque, una sombra que crece con la distancia a la viñeta enfocada (la
   * opción "sombra" de la barra). Quedan tres planos: la viñeta nítida, las vecinas desenfocadas y lo lejano a
   * oscuras. En 0, sin sombra; es lo oscuro que llega a estar lo más lejano.
   */
  focusShadow = 0;

  #app: Application;
  #world = new Container();
  #art = new Sprite();
  #dialogue = new Container();
  #sprites = new Map<string, Sprite>();
  /** Desenfoque de entrada de cada bloque de diálogo. */
  #blurs = new Map<string, BlurFilter>();
  /** Pantalla táctil: se ahorran los efectos que más le cuestan a la placa de un celular. */
  #lite = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
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
  /** La silueta de la viñeta con borde suave, que se recorta de la capa de encima. */
  #holeCanvas: HTMLCanvasElement | null = null;
  /**
   * La sombra, aparte del desenfoque: un degradé suave, así que se arma a muy baja
   * resolución y cuesta poco rehacerla y subirla a la placa en cada viñeta.
   */
  #shadeSprite = new Sprite();
  #shadeTexture: Texture | null = null;
  #shadeCanvas: HTMLCanvasElement | null = null;
  /** Cercanía a la viñeta enfocada, para la sombra: blanco cerca, nada lejos. */
  #nearCanvas: HTMLCanvasElement | null = null;
  /** Papel alrededor de la hoja, para que la sombra siga afuera sin corte (sin fondo de tapas). */
  #paperFrame = new Graphics();
  /** Hay que volver a dibujar: algo cambió desde el último cuadro. */
  #dirty = true;
  #lastView = { x: NaN, y: NaN, scale: NaN };
  /** El tono del papel de la página actual, para oscurecer también lo que queda fuera de ella. */
  #paper = 0xffffff;
  #overlayTexture: Texture | null = null;
  /** Página desenfocada a un cuarto de resolución, por página y ajuste. */
  #blurredPages = new Map<number, { key: string; canvas: HTMLCanvasElement }>();
  #focusKey = "";

  /**
   * El fondo: la tapa del tomo en trama, chica y repetida en mosaico, quieta detrás de la
   * página como un papel tapiz. Opcional ("fondo" en la barra); sin ella, el color del papel.
   */
  #backdrop = new TilingSprite();
  #backdropTexture: Texture | null = null;

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
    this.#world.addChild(this.#paperFrame, this.#art, this.#blurred, this.#shadeSprite, this.#dialogue);
    this.#blurred.visible = false;
    this.#shadeSprite.visible = false;
    // Se dibuja solo cuando algo cambió: con la página quieta, esperando que se lea, no hay
    // nada que dibujar, y redibujar sesenta veces por segundo varias capas del tamaño de la
    // pantalla le quitaba al celular lo que necesita para mover la cámara sin tirones.
    app.ticker.remove(app.render, app);
    app.ticker.add(
      () => {
        if (!this.#dirty) return;
        this.#dirty = false;
        app.render();
      },
      undefined,
      UPDATE_PRIORITY.LOW,
    );
    app.renderer.on("resize", () => {
      this.#dirty = true;
    });
    // Los efectos van fuera del mundo: se dibujan sobre la pantalla y no los arrastra la
    // cámara, que es lo que hace que un destello se sienta como un golpe y no como algo
    // pegado a la página.
    this.#invert.blendMode = "difference";
    this.#invert.visible = false;
    this.#fx.addChild(this.#streaks, this.#invert, this.#flash, this.#curtain);
    this.#backdrop.visible = false;
    app.stage.addChild(this.#backdrop, this.#world, this.#fx);
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
      // Las texturas las suelta el escenario según la página que se lee. El recolector de Pixi
      // descargaba las que llevaban un rato sin usarse y, al volver, las subía de nuevo desde
      // una imagen ya cerrada: la página quedaba vacía.
      textureGCActive: false,
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
    this.#dirty = true;
    // Una imagen cerrada no se puede dibujar: queda lo que está a la vista hasta la próxima.
    if (bitmap.width === 0) return;
    if (frame.page !== this.#page) {
      this.#bitmaps.set(frame.page, bitmap);
      this.#page = frame.page;
      this.#evict(frame.page);
      // El fondo toma el tono del papel: cuando el encuadre se sale de la hoja, en vez de
      // un corte contra el negro parece que la página siguiera.
      this.#paper = paperColor(bitmap);
      this.#app.renderer.background.color = this.#paper;
    }

    const focused =
      this.focusStrength > 0 && Boolean(frame.polygon && frame.polygon.length >= 3);

    this.#art.texture = this.#texture(frame.page, bitmap);
    if (focused) {
      const key = `${frame.page}:${frame.id}:${this.focusStrength}:${this.focusBlur}:${this.focusFeather}:${this.focusShadow}`;
      if (key !== this.#focusKey) {
        this.#composeFocus(frame, bitmap);
        this.#focusKey = key;
      }
    } else {
      this.#focusKey = "";
      this.#blurred.visible = false;
      this.#clearShade();
    }

    this.#placeDialogue(frame);
  }

  /**
   * Deja lista una página que viene, con la cámara quieta: la sube a la placa y arma su
   * fondo desenfocado. Hacerlo recién al llegar a ella era un tirón en cada cambio de página,
   * justo cuando arranca el movimiento: en el celular, subir una página entera tarda decenas
   * de milisegundos.
   */
  prepare(page: number, bitmap: ImageBitmap): void {
    if (bitmap.width === 0 || page === this.#page || outOfReach(page, this.#page, this.#direction)) return;
    const tex = this.#texture(page, bitmap);
    this.#app.renderer.texture.initSource(tex.source);
    if (this.focusStrength > 0) this.#blurredPage(page, bitmap);
  }

  /**
   * Pone de fondo la tapa en trama, o lo saca con `null`. La trama se arma una vez: puntos
   * apenas más oscuros que el papel, con poco contraste, para que se lea como textura y no
   * compita con la página.
   */
  setBackdrop(cover: ImageBitmap | null): void {
    this.#dirty = true;
    if (cover && cover.width === 0) return;
    this.#backdropTexture?.destroy(true);
    this.#backdropTexture = null;
    if (!cover) {
      this.#backdrop.visible = false;
      this.#focusKey = "";
      return;
    }
    // La baldosa al tamaño con que se va a ver: si se estira, los puntos crecen y se pierde
    // la tapa. Con un margen de papel alrededor, para que se lea como tapas una al lado de la
    // otra y no como una sola imagen cortada.
    const res = Math.min(window.devicePixelRatio || 1, 2);
    const tileH = Math.round(MOSAIC.height * res);
    const tileW = Math.round((tileH * cover.width) / cover.height);
    const gap = Math.round(MOSAIC.gap * res);
    const art = screened(cover, tileW, tileH, MOSAIC.cell * res);
    const tile = document.createElement("canvas");
    tile.width = tileW + gap;
    tile.height = tileH + gap;
    const tx = tile.getContext("2d", CPU_2D)!;
    tx.fillStyle = `#${darken(this.#paper, MOSAIC.joint).toString(16).padStart(6, "0")}`;
    tx.fillRect(0, 0, tile.width, tile.height);
    tx.drawImage(art, gap / 2, gap / 2, tileW, tileH);
    this.#backdropTexture = Texture.from(tile);
    this.#backdrop.texture = this.#backdropTexture;
    this.#backdrop.tileScale.set(1 / res);
    this.#backdrop.visible = true;
    this.#fitBackdrop();
    this.#focusKey = "";
  }

  get hasBackdrop(): boolean {
    return this.#backdrop.visible;
  }

  /** El mosaico cubre la pantalla entera. */
  #fitBackdrop(): void {
    if (!this.#backdrop.visible) return;
    const { width, height } = this.#app.screen;
    if (this.#backdrop.width !== width || this.#backdrop.height !== height) {
      this.#backdrop.width = width;
      this.#backdrop.height = height;
      this.#dirty = true;
    }
  }

  /** Aplica la cámara. Llamar después de `camera.update()`. */
  render(t: Transform = this.camera.transform): void {
    this.#fitBackdrop();
    const v = this.#lastView;
    if (t.x !== v.x || t.y !== v.y || t.scale !== v.scale) {
      this.#world.position.set(t.x, t.y);
      this.#world.scale.set(t.scale);
      this.#lastView = { x: t.x, y: t.y, scale: t.scale };
      this.#dirty = true;
    }
  }

  /** Pide un cuadro: para cambios que no pasan por la cámara. */
  invalidate(): void {
    this.#dirty = true;
  }

  /** Rehace el foco cuando cambian sus ajustes sin cambiar de encuadre. */
  refocus(frame: Frame): void {
    this.#focusKey = "";
    const bitmap = this.#bitmaps.get(frame.page);
    // Cerrada no sirve: queda lo que está a la vista hasta la próxima página.
    if (bitmap && bitmap.width > 0) this.show(frame, bitmap);
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
    this.#dirty = true;
    // Con su textura: si no, cada página dejaba la de sus globos ocupando la placa.
    this.#dialogue.removeChildren().forEach((child) => child.destroy({ texture: true, textureSource: true }));
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
      // En el celular el globo entra sin desenfoque: el filtro pasa por la placa en cada
      // cuadro de la aparición, y ahí se notaba.
      if (!this.#lite) this.#blurs.set(entry.id, new BlurFilter({ strength: DIALOGUE_ENTRY_BLUR, quality: 2 }));
    }
  }

  /**
   * Dispara un efecto sobre la pantalla.
   *
   * Uno por vez: el que entra reemplaza al anterior. Superponerlos es lo que convierte un
   * golpe en un revoltijo.
   */
  playFx(kind: string, power: number, ms: number): void {
    this.#dirty = true;
    if (kind === "shake") {
      this.camera.shake(power, ms);
      return;
    }
    if (kind === "flash" || kind === "speedlines") {
      this.#fxState = { kind, left: ms, total: Math.max(ms, 1), power };
      if (kind === "speedlines") {
        const { w, h } = this.viewport;
        this.#drawSpeedlines(w, h, power);
        this.#streaks.alpha = 0;
      }
    }
  }

  /**
   * Cubre la pantalla y la despeja en `ms`.
   *
   * Se usa al abrir: la primera página no aparece de golpe, se descubre mientras la cámara
   * se abre sobre ella.
   */
  openCurtain(ms: number, color = 0x101014): void {
    this.#dirty = true;
    this.#curtainState = { left: ms, total: Math.max(ms, 1), color };
  }

  /** Avanza los efectos en curso. Devuelve si queda alguno vivo. */
  updateFx(dtMs: number): boolean {
    // Mientras haya un efecto, y un cuadro más al terminar para borrarlo.
    const alive = this.#stepFx(dtMs);
    if (alive || this.#fxAlive) this.#dirty = true;
    this.#fxAlive = alive;
    return alive;
  }

  #fxAlive = false;

  #stepFx(dtMs: number): boolean {
    // Las figuras se dibujan una vez y acá solo cambia su transparencia: rehacerlas en cada
    // cuadro —el telón, el destello, las doscientas líneas de velocidad— era trabajo de
    // geometría a sesenta cuadros por segundo, y en el celular el golpe venía con un tirón.
    const { w, h } = this.viewport;

    // El telón corre por su cuenta: se abre aunque no haya ningún efecto en curso.
    const curtain = this.#curtainState;
    if (curtain) {
      curtain.left -= dtMs;
      if (curtain.left <= 0) {
        this.#curtainState = null;
        this.#curtain.visible = false;
      } else {
        this.#cover(this.#curtain, curtain.color, w, h);
        // Se despeja al principio despacio y al final rápido: deja ver la portada entrando.
        this.#curtain.alpha = Math.pow(curtain.left / curtain.total, 0.7);
      }
    }

    const state = this.#fxState;
    if (!state) {
      this.#invert.visible = false;
      this.#flash.visible = false;
      this.#streaks.visible = false;
      return this.#curtainState !== null;
    }

    state.left -= dtMs;
    if (state.left <= 0) {
      this.#fxState = null;
      this.#invert.visible = false;
      this.#flash.visible = false;
      this.#streaks.visible = false;
      return false;
    }

    const t = 1 - state.left / state.total;

    if (state.kind === "flash") {
      // Arranca invirtiendo la imagen unos pocos cuadros —el impact frame del anime— y
      // recién después destella. Invertir marca el golpe mucho más que iluminar.
      if (t < 0.12) {
        this.#cover(this.#invert, 0xffffff, w, h);
        this.#flash.visible = false;
        return true;
      }
      this.#invert.visible = false;
      const u = (t - 0.12) / 0.88;
      this.#cover(this.#flash, 0xffffff, w, h);
      this.#flash.alpha = state.power * (u < 0.12 ? u / 0.12 : Math.pow(1 - (u - 0.12) / 0.88, 2));
      return true;
    }

    // Las líneas se armaron al empezar con el hueco más chico; el hueco se abre agrandando
    // el dibujo desde el centro, y los extremos ya están fuera de la pantalla.
    this.#streaks.visible = true;
    this.#streaks.position.set(w / 2, h / 2);
    this.#streaks.scale.set((SPEEDLINE_HOLE.from + SPEEDLINE_HOLE.grow * t) / SPEEDLINE_HOLE.from);
    this.#streaks.alpha = (t < 0.15 ? t / 0.15 : Math.pow(1 - (t - 0.15) / 0.85, 1.6)) * 0.9;
    return true;
  }

  /** Un rectángulo que tapa la pantalla; se rehace solo si cambió de tamaño o de color. */
  #covers = new WeakMap<Graphics, string>();
  #cover(g: Graphics, color: number, w: number, h: number): void {
    g.visible = true;
    const key = `${w}x${h}:${color}`;
    if (this.#covers.get(g) === key) return;
    this.#covers.set(g, key);
    g.clear().rect(0, 0, w, h).fill({ color, alpha: 1 });
  }

  /**
   * Líneas de velocidad radiales: la firma visual del anime para el impacto.
   *
   * Salen del centro hacia los bordes dejando un hueco limpio en el medio, para que el
   * dibujo se siga leyendo. El hueco se abre a medida que el efecto avanza, y eso es lo que
   * da la sensación de que algo estalla hacia afuera.
   *
   * Se dibujan centradas en el origen, una sola vez por golpe.
   */
  #drawSpeedlines(w: number, h: number, power: number): void {
    const reach = Math.hypot(w, h) / 2;
    const hole = reach * SPEEDLINE_HOLE.from;
    const count = Math.round(70 + 130 * power);
    this.#streaks.clear();

    for (let i = 0; i < count; i++) {
      // Distribución fija por índice: las mismas líneas cada vez.
      const seed = Math.sin(i * 12.9898) * 43758.5453;
      const jitter = seed - Math.floor(seed);
      const angle = (i / count) * Math.PI * 2 + jitter * 0.05;
      const start = hole * (0.85 + jitter * 0.3);
      const end = reach * (1.05 + jitter * 0.25);
      const width = 1 + jitter * (2 + 3 * power);

      this.#streaks
        .moveTo(Math.cos(angle) * start, Math.sin(angle) * start)
        .lineTo(Math.cos(angle) * end, Math.sin(angle) * end)
        .stroke({ width, color: jitter > 0.5 ? 0x000000 : 0xffffff });
    }
  }

  /** Muestra un bloque de diálogo. `progress` de 0 a 1 anima su entrada. */
  revealDialogue(id: string, progress: number): void {
    this.#dirty = true;
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
    this.#shadeTexture?.destroy(true);
    this.#shadeTexture = null;
    this.#backdropTexture?.destroy(true);
    this.#backdropTexture = null;
    this.#app.destroy(true, { children: true });
  }

  /**
   * La sombra: nada junto a la viñeta, y de a poco más oscura con la distancia, también fuera
   * de la hoja. Es la silueta engordada y muy desenfocada restada de una capa negra; como es
   * un degradé suave, se arma a un dieciseisavo y se estira, y rehacerla en cada viñeta no
   * le cuesta nada al celular.
   */
  #composeShade(frame: Frame, width: number, height: number): void {
    const side = Math.max(width, height);
    const pad = Math.round(side * (this.#backdrop.visible ? SHADOW_PAD_BACKDROP : SHADOW_PAD));
    const sw = Math.max(1, Math.round((width + 2 * pad) / SHADE_SCALE));
    const sh = Math.max(1, Math.round((height + 2 * pad) / SHADE_SCALE));
    const fresh = (c: HTMLCanvasElement | null) => {
      if (c && c.width === sw && c.height === sh) return c;
      const n = document.createElement("canvas");
      n.width = sw;
      n.height = sh;
      return n;
    };
    this.#nearCanvas = fresh(this.#nearCanvas);
    const resized = this.#shadeCanvas?.width !== sw || this.#shadeCanvas?.height !== sh;
    this.#shadeCanvas = fresh(this.#shadeCanvas);
    if (resized || !this.#shadeTexture) {
      this.#shadeTexture?.destroy(true);
      this.#shadeTexture = Texture.from(this.#shadeCanvas);
    }

    const reach = side * SHADOW_REACH;
    const nx = this.#nearCanvas.getContext("2d", CPU_2D)!;
    nx.setTransform(1, 0, 0, 1, 0, 0);
    nx.filter = "none";
    nx.clearRect(0, 0, sw, sh);
    nx.setTransform(1 / SHADE_SCALE, 0, 0, 1 / SHADE_SCALE, pad / SHADE_SCALE, pad / SHADE_SCALE);
    nx.filter = `blur(${reach / SHADE_SCALE / 2}px)`;
    nx.fillStyle = "#fff";
    nx.strokeStyle = "#fff";
    nx.lineJoin = "round";
    nx.lineWidth = reach;
    nx.beginPath();
    frame.polygon!.forEach(([x, y], i) => (i === 0 ? nx.moveTo(x, y) : nx.lineTo(x, y)));
    nx.closePath();
    nx.fill();
    nx.stroke();
    nx.filter = "none";

    const dx = this.#shadeCanvas.getContext("2d", CPU_2D)!;
    dx.setTransform(1, 0, 0, 1, 0, 0);
    dx.globalCompositeOperation = "source-over";
    dx.clearRect(0, 0, sw, sh);
    dx.fillStyle = `rgba(0, 0, 0, ${this.focusShadow})`;
    dx.fillRect(0, 0, sw, sh);
    dx.globalCompositeOperation = "destination-out";
    dx.drawImage(this.#nearCanvas, 0, 0);
    dx.globalCompositeOperation = "source-over";
    this.#shadeTexture.source.update();

    this.#shadeSprite.texture = this.#shadeTexture;
    this.#shadeSprite.setSize(width + 2 * pad, height + 2 * pad);
    this.#shadeSprite.position.set(-pad, -pad);
    this.#shadeSprite.visible = true;

    // El papel alrededor de la hoja, con el mismo apagado que el entorno de la página; con la
    // tapa de fondo no, que la taparía: ahí la sombra cae sobre el mosaico.
    const level = 1 - this.focusStrength;
    this.#paperFrame.clear();
    if (!this.#backdrop.visible) {
      const paper = darken(this.#paper, 1 - level);
      this.#paperFrame
        .rect(-pad, -pad, width + 2 * pad, pad)
        .rect(-pad, height, width + 2 * pad, pad)
        .rect(-pad, 0, pad, height)
        .rect(width, 0, pad, height)
        .fill(paper);
    }
    // Más allá, el tono del borde: papel con la sombra entera y el apagado.
    const far = 1 - (1 - this.focusShadow) * level;
    this.#app.renderer.background.color = this.#backdrop.visible ? this.#paper : darken(this.#paper, far);
  }

  /** Saca la sombra: vuelve el fondo de papel liso. */
  #clearShade(): void {
    this.#shadeSprite.visible = false;
    this.#paperFrame.clear();
    this.#app.renderer.background.color = this.#paper;
  }

  /**
   * La página desenfocada, una vez por página: está borrosa de todos modos, así que a un
   * cuarto se ve igual.
   */
  #blurredPage(index: number, bitmap: ImageBitmap): { key: string; canvas: HTMLCanvasElement } {
    const blurKey = `${this.focusBlur}`;
    let page = this.#blurredPages.get(index);
    if (!page || page.key !== blurKey) {
      const sw = Math.max(1, Math.round(bitmap.width / FOCUS_SCALE));
      const sh = Math.max(1, Math.round(bitmap.height / FOCUS_SCALE));
      const canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh;
      const cx = canvas.getContext("2d", CPU_2D)!;
      cx.filter = `blur(${this.focusBlur / FOCUS_SCALE}px)`;
      cx.drawImage(bitmap, 0, 0, sw, sh);
      page = { key: blurKey, canvas };
      this.#blurredPages.set(index, page);
    }
    return page;
  }

  /** Arma el foco de una viñeta: el entorno desenfocado, con el hueco de su silueta. */
  #composeFocus(frame: Frame, bitmap: ImageBitmap): void {
    const { width, height } = bitmap;
    const sw = Math.max(1, Math.round(width / FOCUS_SCALE));
    const sh = Math.max(1, Math.round(height / FOCUS_SCALE));

    const page = this.#blurredPage(frame.page, bitmap);

    let overlay = this.#overlayCanvas;
    if (!overlay || overlay.width !== sw || overlay.height !== sh) {
      overlay = document.createElement("canvas");
      overlay.width = sw;
      overlay.height = sh;
      this.#overlayCanvas = overlay;
      this.#overlayTexture?.destroy(true);
      this.#overlayTexture = Texture.from(overlay);
    }
    const ox = overlay.getContext("2d", CPU_2D)!;
    ox.setTransform(1, 0, 0, 1, 0, 0);
    ox.globalCompositeOperation = "source-over";
    ox.filter = "none";
    ox.clearRect(0, 0, sw, sh);
    ox.drawImage(page.canvas, 0, 0);

    // El hueco: la silueta dilatada y con borde suave. Se dibuja en un lienzo aparte y recién
    // después se recorta de la capa: desenfocar y recortar en un mismo paso a veces no
    // recortaba nada, y la viñeta quedaba desenfocada como el resto.
    //
    // Trazar con grosor además de rellenar dilata la silueta, y así el desvanecido cae por
    // fuera de la viñeta en vez de repartirse a ambos lados de su borde.
    // La máscara de la viñeta es un borde suave: se arma a un dieciseisavo, con un desenfoque
    // chico, y se estira al pegarla. A un cuarto con un desenfoque grande tardaba decenas de
    // milisegundos por viñeta en el celular, y eso era un tirón en cada cambio.
    const hw = Math.max(1, Math.round(width / HOLE_SCALE));
    const hh = Math.max(1, Math.round(height / HOLE_SCALE));
    let hole = this.#holeCanvas;
    if (!hole || hole.width !== hw || hole.height !== hh) {
      hole = document.createElement("canvas");
      hole.width = hw;
      hole.height = hh;
      this.#holeCanvas = hole;
    }
    const hx = hole.getContext("2d", CPU_2D)!;
    const feather = this.focusFeather / HOLE_SCALE;
    hx.setTransform(1, 0, 0, 1, 0, 0);
    hx.filter = "none";
    hx.clearRect(0, 0, hw, hh);
    hx.setTransform(1 / HOLE_SCALE, 0, 0, 1 / HOLE_SCALE, 0, 0);
    hx.filter = feather > 0 ? `blur(${feather / 3}px)` : "none";
    hx.fillStyle = "#fff";
    hx.strokeStyle = "#fff";
    hx.lineJoin = "round";
    hx.lineWidth = feather * HOLE_SCALE;
    hx.beginPath();
    frame.polygon!.forEach(([x, y], i) => (i === 0 ? hx.moveTo(x, y) : hx.lineTo(x, y)));
    hx.closePath();
    hx.fill();
    if (feather > 0) hx.stroke();
    hx.filter = "none";

    ox.setTransform(1, 0, 0, 1, 0, 0);
    ox.globalCompositeOperation = "destination-out";
    ox.imageSmoothingEnabled = true;
    ox.drawImage(hole, 0, 0, sw, sh);
    ox.globalCompositeOperation = "source-over";
    this.#overlayTexture!.source.update();

    // Apagado con un tinte: equivale a la capa negra semitransparente de antes.
    this.#blurred.texture = this.#overlayTexture!;
    this.#blurred.setSize(width, height);
    const level = Math.round(255 * (1 - this.focusStrength));
    this.#blurred.tint = (level << 16) | (level << 8) | level;
    this.#blurred.visible = true;

    if (this.focusShadow > 0) this.#composeShade(frame, width, height);
    else this.#clearShade();
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
    // Solo si es de esta misma imagen: si la página se volvió a decodificar —la anterior se
    // soltó para ahorrar memoria—, la textura vieja apunta a una imagen cerrada y al volver
    // a esa página se veía el globo flotando sin el dibujo.
    if (cached && cached.source.resource === bitmap) return cached;
    cached?.destroy(true);
    const tex = Texture.from(bitmap);
    this.#textures.set(page, tex);
    return tex;
  }

  /**
   * Libera texturas lejanas. Destruye también el ImageBitmap de origen: para entonces ya
   * está subido a la GPU, y el ArchiveSource tolera que se lo cierren por debajo.
   */
  #direction: Direction = 1;
  #lastPage = 0;

  #evict(page: number): void {
    this.#direction = directionOf(page, this.#lastPage, this.#direction);
    this.#lastPage = page;
    for (const [p, tex] of this.#textures) {
      if (outOfReach(p, page, this.#direction)) {
        tex.destroy(true);
        this.#textures.delete(p);
      }
    }
    for (const p of this.#bitmaps.keys()) {
      if (outOfReach(p, page, this.#direction)) this.#bitmaps.delete(p);
    }
    for (const p of this.#blurredPages.keys()) {
      if (outOfReach(p, page, this.#direction)) this.#blurredPages.delete(p);
    }
  }
}

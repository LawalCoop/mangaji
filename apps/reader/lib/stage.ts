import { Application, BlurFilter, Container, Graphics, Sprite, Texture } from "pixi.js";
import { Camera, type Transform } from "./camera";
import type { Frame, Rect } from "./types";

/**
 * La superficie de render. Dibuja un encuadre —un recorte de una página— aplicando la
 * transformación de la cámara al contenedor del mundo.
 *
 * v2 usa el mismo Stage con `frame.polygon` para enmascarar viñetas no rectangulares;
 * v4 agrega las capas de diálogo dentro de `#layers`. El resto del motor no cambia.
 */

/** Texturas vivas alrededor de la página actual. Cada página son ~4 MP en VRAM. */
const TEXTURE_LIMIT = 5;

/** Resolución de la máscara respecto de la página: es difusa, no necesita más. */
const MASK_SCALE = 0.25;

/**
 * Máscara de la viñeta con el borde ya difuminado, pintada en un canvas.
 *
 * El camino directo —un Graphics con un filtro de desenfoque— no sirve: ponerle un filtro
 * a una máscara la rompe y el sprite enmascarado deja de dibujarse. Pintar el degradado en
 * la propia textura no depende de cómo el motor trate los filtros de máscara.
 */
function featheredMask(
  polygon: [number, number][],
  feather: number,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width * MASK_SCALE));
  canvas.height = Math.max(1, Math.ceil(height * MASK_SCALE));

  const ctx = canvas.getContext("2d")!;
  if (feather > 0) ctx.filter = `blur(${(feather / 2) * MASK_SCALE}px)`;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  polygon.forEach(([x, y], i) => {
    const px = x * MASK_SCALE;
    const py = y * MASK_SCALE;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  });
  ctx.closePath();
  ctx.fill();
  return canvas;
}

export class Stage {
  readonly camera = new Camera();
  /**
   * Cuánto se atenúa la página fuera de la viñeta activa: se difumina y se oscurece un
   * poco, sin recortar. La página sigue entera y visible, pero la viñeta que se está
   * leyendo toma protagonismo. En 0 no se dibuja nada de esto.
   */
  focusStrength = 0.16;
  /** Radio del desenfoque del entorno, en píxeles de pantalla. */
  focusBlur = 2.5;
  /**
   * Ancho de la franja donde la viñeta nítida se funde con el entorno difuminado.
   *
   * Sin esto el borde de la máscara es una línea, y el pase de nítido a borroso se ve como
   * un corte —justo lo que este modo quiere evitar—.
   */
  focusFeather = 40;

  #app: Application;
  #world = new Container();
  /** Todo lo que va difuminado: la página y el diálogo de las viñetas que no son la activa. */
  #blurred = new Container();
  #back = new Sprite();
  #backDialogue = new Container();
  #shade = new Graphics();
  /** La misma página, nítida, recortada a la viñeta activa. */
  #art = new Sprite();
  #artMask: Sprite | null = null;
  #dialogue = new Container();
  #sprites = new Map<string, Sprite>();
  /** Posición final de cada sprite, para animar desde un pequeño desplazamiento. */
  #rests = new Map<string, number>();
  #textures = new Map<number, Texture>();
  #page = -1;
  #blur = new BlurFilter({ strength: 2.5, quality: 3 });

  private constructor(app: Application) {
    this.#app = app;
    // El desenfoque se aplica al grupo, no solo a la página: el diálogo de las viñetas
    // que no son la activa tiene que difuminarse con ellas, no quedar nítido flotando.
    this.#blurred.addChild(this.#back, this.#backDialogue);
    this.#blurred.filters = [this.#blur];
    // De atrás hacia adelante: lo difuminado, un velo que lo apaga, la viñeta nítida
    // recortada encima, y su diálogo sobre todo.
    this.#world.addChild(this.#blurred, this.#shade, this.#art, this.#dialogue);
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
   * Muestra un encuadre. Solo cambia la textura si cambió de página, así avanzar entre
   * viñetas de la misma página no re-sube nada a la GPU.
   */
  show(frame: Frame, bitmap: ImageBitmap): void {
    if (frame.page !== this.#page) {
      const texture = this.#texture(frame.page, bitmap);
      this.#art.texture = texture;
      this.#back.texture = texture;
      this.#page = frame.page;
      this.#evict(frame.page);
    }
    this.#drawFocus(frame);
    this.#placeDialogue(frame);
  }

  /** Aplica la cámara. Llamar después de `camera.update()`. */
  render(t: Transform = this.camera.transform): void {
    this.#world.position.set(t.x, t.y);
    this.#world.scale.set(t.scale);
  }

  /** Refresca la atenuación cuando cambia su intensidad sin cambiar de encuadre. */
  refocus(frame: Frame): void {
    this.#drawFocus(frame);
  }

  /**
   * Coloca el diálogo de la viñeta, oculto. El arte base ya no lo tiene: el pipeline lo
   * levantó y dejó el globo vacío, así que hasta que se revele el globo se ve en blanco.
   */
  setDialogue(entries: { id: string; bitmap: ImageBitmap; rect: Rect }[]): void {
    this.#dialogue.removeChildren().forEach((child) => child.destroy());
    this.#backDialogue.removeChildren().forEach((child) => child.destroy());
    this.#sprites.clear();

    this.#rests.clear();
    for (const entry of entries) {
      const sprite = new Sprite(Texture.from(entry.bitmap));
      sprite.position.set(entry.rect.x, entry.rect.y);
      sprite.width = entry.rect.w;
      sprite.height = entry.rect.h;
      sprite.alpha = 0;
      this.#dialogue.addChild(sprite);
      this.#sprites.set(entry.id, sprite);
      this.#rests.set(entry.id, entry.rect.y);
    }
  }

  /**
   * Reparte el diálogo entre la capa nítida y la difuminada según a qué viñeta pertenece.
   * Así el texto ya leído se apaga con su viñeta en vez de flotar nítido sobre el resto.
   */
  #placeDialogue(frame: Frame): void {
    const mine = new Set((frame.layers ?? []).map((l) => l.id));
    for (const [id, sprite] of this.#sprites) {
      const target = mine.has(id) ? this.#dialogue : this.#backDialogue;
      if (sprite.parent !== target) target.addChild(sprite);
    }
  }

  /** Muestra un bloque de diálogo. `progress` de 0 a 1 anima su aparición. */
  revealDialogue(id: string, progress: number): void {
    const sprite = this.#sprites.get(id);
    if (!sprite) return;
    const t = Math.min(Math.max(progress, 0), 1);
    sprite.alpha = t;
    // Un desplazamiento mínimo hacia arriba: da la sensación de que el globo "habla" en
    // vez de que una imagen aparezca de la nada.
    sprite.y = this.#rests.get(id)! + (1 - t) * 6;
  }

  /** Deja todo el diálogo visible de una vez (al saltar beats o al retroceder). */
  showAllDialogue(): void {
    for (const id of this.#sprites.keys()) this.revealDialogue(id, 1);
  }

  destroy(): void {
    for (const [, tex] of this.#textures) tex.destroy(true);
    this.#textures.clear();
    this.#app.destroy(true, { children: true });
  }

  #texture(page: number, bitmap: ImageBitmap): Texture {
    const cached = this.#textures.get(page);
    if (cached) return cached;
    const tex = Texture.from(bitmap);
    this.#textures.set(page, tex);
    return tex;
  }

  /**
   * Da protagonismo a la viñeta activa sin recortarla: el resto de la página queda
   * difuminado y algo apagado, pero visible. Es lo contrario de enmascarar — la hoja
   * sigue entera, y lo que cambia es dónde está el foco.
   *
   * Se logra con dos copias de la misma página: la de atrás lleva el desenfoque, y encima
   * va la nítida recortada a la silueta de la viñeta.
   */
  #drawFocus(frame: Frame): void {
    if (this.#artMask) {
      this.#art.mask = null;
      this.#artMask.destroy({ texture: true, textureSource: true });
      this.#artMask = null;
    }
    this.#shade.clear();

    const focused = this.focusStrength > 0 && frame.polygon && frame.polygon.length >= 3;
    this.#blurred.visible = Boolean(focused);
    // Sin foco no hay recorte: la página nítida se ve entera.
    if (!focused) return;

    this.#blur.strength = this.focusBlur;

    const { width, height } = this.#art.texture;
    // Margen amplio: al alejarse, la cámara ve más allá del borde de la página.
    this.#shade
      .rect(-width, -height, width * 3, height * 3)
      .fill({ color: 0x000000, alpha: this.focusStrength });

    const canvas = featheredMask(frame.polygon!, this.focusFeather, width, height);
    const mask = new Sprite(Texture.from(canvas));
    mask.width = width;
    mask.height = height;

    this.#world.addChild(mask);
    this.#art.mask = mask;
    this.#artMask = mask;
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
  }
}

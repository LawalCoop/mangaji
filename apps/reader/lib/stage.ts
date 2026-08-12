import { Application, Container, Graphics, Sprite, Texture } from "pixi.js";
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

export class Stage {
  readonly camera = new Camera();
  /**
   * Cuánto se oscurece la página fuera de la viñeta activa. 0 = nada, que es el default:
   * el foco lo da el encuadre de la cámara, no un recorte. Recortar duro rompe la ilusión
   * de estar leyendo una página y deja bordes que cantan.
   */
  focusStrength = 0;

  #app: Application;
  #world = new Container();
  #art = new Sprite();
  #focus = new Graphics();
  #dialogue = new Container();
  #sprites = new Map<string, Sprite>();
  /** Posición final de cada sprite, para animar desde un pequeño desplazamiento. */
  #rests = new Map<string, number>();
  #textures = new Map<number, Texture>();
  #page = -1;

  private constructor(app: Application) {
    this.#app = app;
    // El diálogo va encima del arte pero debajo de la atenuación, para que la viñeta
    // activa se lea y las vecinas queden parejas.
    this.#world.addChild(this.#art, this.#dialogue, this.#focus);
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
      this.#art.texture = this.#texture(frame.page, bitmap);
      this.#page = frame.page;
      this.#evict(frame.page);
    }
    this.#drawFocus(frame);
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
   * Atenúa la página fuera de la viñeta activa, dejándola visible por debajo.
   *
   * Es lo contrario de recortar: la página sigue entera, y la viñeta se destaca por el
   * encuadre. Con `focusStrength` en 0 no dibuja nada.
   */
  #drawFocus(frame: Frame): void {
    const g = this.#focus;
    g.clear();
    if (this.focusStrength <= 0 || !frame.polygon || frame.polygon.length < 3) return;

    const { width, height } = this.#art.texture;
    // Margen amplio: al alejarse la cámara se ve más allá del borde de la página.
    g.rect(-width, -height, width * 3, height * 3);
    g.poly(frame.polygon.flat());
    g.cut();
    g.fill({ color: 0x000000, alpha: this.focusStrength });
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

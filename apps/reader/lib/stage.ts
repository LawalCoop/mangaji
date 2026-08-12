import { Application, Container, Graphics, Sprite, Texture } from "pixi.js";
import { Camera, type Transform } from "./camera";
import type { Frame } from "./types";

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
  #app: Application;
  #world = new Container();
  #art = new Sprite();
  #mask: Graphics | null = null;
  #layers = new Container();
  #textures = new Map<number, Texture>();
  #page = -1;

  private constructor(app: Application) {
    this.#app = app;
    this.#world.addChild(this.#art, this.#layers);
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
   * viñetas de la misma página (v2) no re-sube nada a la GPU.
   */
  show(frame: Frame, bitmap: ImageBitmap): void {
    if (frame.page !== this.#page) {
      this.#art.texture = this.#texture(frame.page, bitmap);
      this.#page = frame.page;
      this.#evict(frame.page);
    }
    this.#applyMask(frame);
  }

  /** Aplica la cámara. Llamar después de `camera.update()`. */
  render(t: Transform = this.camera.transform): void {
    this.#world.position.set(t.x, t.y);
    this.#world.scale.set(t.scale);
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

  /** Recorta a la silueta de la viñeta. Sin polígono (v1) no hay máscara. */
  #applyMask(frame: Frame): void {
    if (this.#mask) {
      this.#world.mask = null;
      this.#mask.destroy();
      this.#mask = null;
    }
    if (!frame.polygon || frame.polygon.length < 3) return;

    const g = new Graphics();
    g.poly(frame.polygon.flat()).fill(0xffffff);
    this.#world.addChild(g);
    this.#world.mask = g;
    this.#mask = g;
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

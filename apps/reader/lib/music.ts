import type { Mood } from "./mood";

/**
 * Acompañamiento generado en el navegador.
 *
 * No hay archivos: la música se sintetiza a partir de la paleta del mood. Además de evitar
 * empaquetar audio ajeno, permite que reaccione a lo que está pasando —densa en una página
 * de batalla, quieta en una de diálogo— cosa que una pista grabada no puede hacer.
 *
 * Se construye sobre lo mínimo: osciladores con envolvente, un filtro que abre y cierra
 * según la intensidad, y un eco que hace las veces de sala.
 */
export class Music {
  #ctx: AudioContext | null = null;
  #master: GainNode | null = null;
  #timer: number | null = null;
  #mood: Mood;
  #step = 0;
  /** 0..1, sube en las viñetas intensas y baja solo. */
  #heat = 0;

  constructor(mood: Mood) {
    this.#mood = mood;
  }

  get playing(): boolean {
    return this.#ctx !== null;
  }

  /** Arranca. Debe llamarse desde un gesto del usuario: el audio no suena sin eso. */
  async start(): Promise<void> {
    if (this.#ctx) return;
    const ctx = new AudioContext();
    await ctx.resume();

    const master = ctx.createGain();
    master.gain.value = 0;
    master.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 2.5);

    // Un eco corto y realimentado da profundidad sin necesidad de una respuesta de sala.
    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = 0.42;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.34;
    const damp = ctx.createBiquadFilter();
    damp.type = "lowpass";
    damp.frequency.value = 1800;

    master.connect(ctx.destination);
    master.connect(delay);
    delay.connect(damp);
    damp.connect(feedback);
    feedback.connect(delay);
    delay.connect(master);

    this.#ctx = ctx;
    this.#master = master;
    this.#tick();
  }

  stop(): void {
    if (this.#timer) window.clearTimeout(this.#timer);
    this.#timer = null;
    const ctx = this.#ctx;
    const master = this.#master;
    this.#ctx = null;
    this.#master = null;
    if (!ctx || !master) return;
    // Se apaga con una caída, no de golpe.
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
    master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8);
    window.setTimeout(() => void ctx.close(), 1000);
  }

  /**
   * Cambia de paleta y suena el cambio enseguida.
   *
   * Sin reprogramar, el acorde siguiente ya estaba agendado con el tiempo del mood anterior
   * y el cambio tardaba en oírse —hasta seis segundos y medio viniendo de zen—, que se
   * siente como que el control no hizo nada.
   */
  setMood(mood: Mood): void {
    this.#mood = mood;
    if (!this.#ctx) return;
    if (this.#timer) window.clearTimeout(this.#timer);
    this.#timer = null;
    this.#tick();
  }

  /** Sube la intensidad. Se llama cuando una viñeta trae un efecto fuerte. */
  accent(amount = 1): void {
    this.#heat = Math.min(1, this.#heat + amount);
  }

  #tick = (): void => {
    const ctx = this.#ctx;
    const master = this.#master;
    if (!ctx || !master) return;

    const { scale, root, step, weight, drive, wave, bright } = this.#mood.music;
    const t = ctx.currentTime + 0.05;
    const heat = this.#heat;

    // Grado de la escala: avanza de a poco y a veces salta, para que no quede en bucle.
    const degree = scale[(this.#step * 2 + (this.#step % 3)) % scale.length];
    const freq = root * Math.pow(2, degree / 12);

    this.#pad(t, freq * 0.5, step * 1.8, 0.16 * weight, wave, bright);
    this.#pad(t + step * 0.15, freq, step * 1.2, 0.1, wave, bright);
    // La quinta entra sola cuando hay intensidad: engorda sin ensuciar.
    if (heat > 0.25) {
      this.#pad(t + step * 0.3, freq * 1.5, step * 0.8, 0.07 * heat, wave, bright);
    }

    if (drive > 0 && this.#step % 2 === 0) this.#pulse(t, drive * (0.5 + heat * 0.5));

    this.#step++;
    this.#heat = Math.max(0, heat - 0.22);
    this.#timer = window.setTimeout(this.#tick, step * 1000);
  };

  /** Nota sostenida con ataque y caída largos. */
  #pad(
    at: number,
    freq: number,
    dur: number,
    level: number,
    wave: OscillatorType,
    bright: number,
  ): void {
    const ctx = this.#ctx;
    const master = this.#master;
    if (!ctx || !master) return;

    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.value = freq;
    // Un segundo oscilador apenas desafinado: es lo que da cuerpo al sonido.
    const osc2 = ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.value = freq * 1.004;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    // El brillo lo fija el mood; la intensidad de la lectura lo abre un poco más.
    filter.frequency.setValueAtTime(bright + 2200 * this.#heat, at);
    filter.Q.value = 0.7;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + dur * 0.35);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);

    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(master);

    osc.start(at);
    osc2.start(at);
    osc.stop(at + dur + 0.1);
    osc2.stop(at + dur + 0.1);
  }

  /** Golpe grave: ruido filtrado más una caída de tono. */
  #pulse(at: number, level: number): void {
    const ctx = this.#ctx;
    const master = this.#master;
    if (!ctx || !master) return;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(90, at);
    osc.frequency.exponentialRampToValueAtTime(38, at + 0.22);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level * 0.5, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);

    osc.connect(gain);
    gain.connect(master);
    osc.start(at);
    osc.stop(at + 0.4);
  }
}

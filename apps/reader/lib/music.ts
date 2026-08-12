import { Midi } from "@tonejs/midi";
import type { Mood } from "./mood";

/**
 * Acompañamiento del lector: una pieza MIDI por mood, en bucle.
 *
 * Las piezas son de dominio público (CC0) y viven en `public/music`. El navegador no
 * reproduce MIDI, así que se parsea y se sintetiza acá: además de evitar cargar un banco de
 * sonidos de varios MB, deja que el timbre lo ponga el mood y que la música responda a la
 * lectura —cada efecto fuerte abre el filtro y baja solo—, cosa que una pista grabada no
 * puede hacer.
 *
 * Las notas se programan por ventanas y no de una vez: una pieza entera son miles de notas,
 * y agendarlas todas al arrancar traba el hilo y hace imposible el bucle.
 */

/** Cada cuánto se despierta el programador, en ms. */
const TICK_MS = 120;
/** Cuánto por delante se agenda, en segundos. */
const LOOKAHEAD = 0.45;
/**
 * Tope de notas agendadas por pasada.
 *
 * Es además la red que corta cualquier bucle desbocado: si por lo que fuera el reloj y la
 * pieza se desincronizan, esto acota el daño a unas pocas voces en vez de dejar que se
 * apilen sin freno.
 */
const MAX_NOTES_PER_PASS = 24;

type Note = { time: number; duration: number; freq: number; velocity: number; drum: boolean };

export class Music {
  #ctx: AudioContext | null = null;
  #master: GainNode | null = null;
  #timer: number | null = null;
  #mood: Mood;

  #notes: Note[] = [];
  #length = 0;
  #cursor = 0;
  /** Momento del reloj de audio en que empezó la vuelta actual. */
  #origin = 0;
  #loading: string | null = null;
  /** 0..1, sube en las viñetas intensas y baja solo. */
  #heat = 0;
  /** Volumen elegido por quien lee. Los fundidos van hacia este valor, no a uno fijo. */
  #volume = 0.42;

  constructor(mood: Mood, volume = 0.42) {
    this.#mood = mood;
    this.#volume = volume;
  }

  get volume(): number {
    return this.#volume;
  }

  setVolume(value: number): void {
    this.#volume = Math.min(Math.max(value, 0), 1);
    const ctx = this.#ctx;
    const master = this.#master;
    if (!ctx || !master) return;
    // Rampa corta: saltar de golpe produce un chasquido.
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
    master.gain.linearRampToValueAtTime(this.#volume, ctx.currentTime + 0.08);
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
    master.gain.linearRampToValueAtTime(this.#volume, ctx.currentTime + 2);

    // Limitador al final de la cadena: por muchas voces que coincidan, la suma no distorsiona.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.18;
    limiter.connect(ctx.destination);

    // Un eco corto y realimentado da profundidad sin una respuesta de sala.
    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = 0.38;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.26;
    const damp = ctx.createBiquadFilter();
    damp.type = "lowpass";
    damp.frequency.value = 2000;

    master.connect(limiter);
    master.connect(delay);
    delay.connect(damp);
    damp.connect(feedback);
    feedback.connect(delay);
    // El eco vuelve al limitador y no al master: si volviera al master, el master lo
    // reinyectaría en el propio eco y la señal se realimentaría a sí misma creciendo sola.
    delay.connect(limiter);

    this.#ctx = ctx;
    this.#master = master;

    await this.#load(this.#mood.id);
    this.#origin = ctx.currentTime + 0.2;
    this.#schedule();
  }

  stop(): void {
    if (this.#timer) window.clearInterval(this.#timer);
    this.#timer = null;
    const ctx = this.#ctx;
    const master = this.#master;
    this.#ctx = null;
    this.#master = null;
    this.#notes = [];
    if (!ctx || !master) return;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
    master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
    window.setTimeout(() => void ctx.close(), 800);
  }

  /** Cambia de pieza. Se cruza con un fundido corto para que no corte de golpe. */
  async setMood(mood: Mood): Promise<void> {
    this.#mood = mood;
    const ctx = this.#ctx;
    const master = this.#master;
    if (!ctx || !master) return;

    const level = master.gain.value;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(level, ctx.currentTime);
    master.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.5);

    await this.#load(mood.id);
    if (!this.#ctx) return; // se apagó mientras cargaba

    this.#cursor = 0;
    this.#origin = ctx.currentTime + 0.1;
    master.gain.linearRampToValueAtTime(this.#volume, ctx.currentTime + 1.2);
  }

  /** Sube la intensidad. Se llama cuando una viñeta trae un efecto fuerte. */
  accent(amount = 1): void {
    this.#heat = Math.min(1, this.#heat + amount);
  }

  async #load(id: string): Promise<void> {
    if (this.#loading === id) return;
    this.#loading = id;
    try {
      const res = await fetch(`/music/${id}.mid`);
      if (!res.ok) throw new Error(`sin pieza para ${id}`);
      const midi = new Midi(await res.arrayBuffer());

      const notes: Note[] = [];
      for (const track of midi.tracks) {
        // El canal 10 del estándar MIDI es percusión: sus notas son instrumentos, no tonos.
        const drum = track.channel === 9;
        for (const n of track.notes) {
          notes.push({
            time: n.time,
            duration: Math.min(n.duration, 4),
            freq: 440 * Math.pow(2, (n.midi - 69) / 12),
            velocity: n.velocity,
            drum,
          });
        }
      }
      notes.sort((a, b) => a.time - b.time);

      this.#notes = notes;
      this.#length = Math.max(midi.duration, 1);
      this.#cursor = 0;
    } catch {
      this.#notes = [];
      this.#length = 1;
    }
  }

  #schedule(): void {
    if (this.#timer) window.clearInterval(this.#timer);
    this.#timer = window.setInterval(() => this.#pump(), TICK_MS);
  }

  #pump(): void {
    const ctx = this.#ctx;
    if (!ctx || this.#notes.length === 0) return;

    const horizon = ctx.currentTime + LOOKAHEAD;
    let placed = 0;

    while (placed < MAX_NOTES_PER_PASS) {
      const note = this.#notes[this.#cursor];
      const at = this.#origin + note.time;
      if (at > horizon) break;

      // Solo suena lo que todavía no pasó; lo vencido se saltea sin agendar.
      if (at >= ctx.currentTime) {
        note.drum ? this.#hit(at, note) : this.#voice(at, note);
        placed++;
      }

      this.#cursor++;
      if (this.#cursor < this.#notes.length) continue;

      // Fin de la vuelta: el origen se corre una pieza entera y arranca de nuevo.
      //
      // Si además quedó por detrás del reloj —porque la pestaña estuvo en segundo plano, o
      // porque la pieza es más corta que la ventana— hay que resincronizar. Sin esto todas
      // las notas de la vuelta nueva vuelven a caer dentro del horizonte y se reprograman
      // en cada pasada, apilando voces hasta saturar.
      this.#cursor = 0;
      this.#origin += this.#length;
      if (this.#origin + this.#length <= ctx.currentTime) {
        this.#origin = ctx.currentTime;
      }
    }

    this.#heat = Math.max(0, this.#heat - 0.015);
  }

  #voice(at: number, note: Note): void {
    const ctx = this.#ctx;
    const master = this.#master;
    if (!ctx || !master) return;

    const { wave, bright, weight } = this.#mood.music;
    const dur = Math.max(note.duration, 0.08);

    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.value = note.freq;
    // Un segundo oscilador apenas desafinado: es lo que da cuerpo al sonido.
    const osc2 = ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.value = note.freq * 1.005;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    // El brillo lo fija el mood; la intensidad de la lectura lo abre por encima.
    filter.frequency.setValueAtTime(bright + 2600 * this.#heat, at);
    filter.Q.value = 0.6;

    const gain = ctx.createGain();
    const level = 0.16 * note.velocity * weight;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + Math.min(0.04, dur * 0.3));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);

    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(master);

    osc.start(at);
    osc2.start(at);
    osc.stop(at + dur + 0.05);
    osc2.stop(at + dur + 0.05);
  }

  /** Percusión: golpe grave con caída de tono, o chasquido según la altura. */
  #hit(at: number, note: Note): void {
    const ctx = this.#ctx;
    const master = this.#master;
    if (!ctx || !master) return;

    const level = 0.5 * note.velocity * this.#mood.music.drive;
    if (level <= 0.001) return;

    const low = note.freq < 200;
    const osc = ctx.createOscillator();
    osc.type = low ? "sine" : "square";
    osc.frequency.setValueAtTime(low ? 110 : 320, at);
    osc.frequency.exponentialRampToValueAtTime(low ? 40 : 180, at + 0.12);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level * (low ? 0.6 : 0.12), at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + (low ? 0.3 : 0.09));

    osc.connect(gain);
    gain.connect(master);
    osc.start(at);
    osc.stop(at + 0.35);
  }
}

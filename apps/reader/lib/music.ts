import { Midi } from "@tonejs/midi";
import type { Mood } from "./mood";
import { asset } from "./base";

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

type Note = {
  time: number;
  duration: number;
  freq: number;
  velocity: number;
  drum: boolean;
  /** Número de nota MIDI: en la percusión dice qué instrumento es. */
  midi: number;
};

/** Tope de voces sonando a la vez: si se apilan, se embarra y satura. */
const MAX_VOICES = 28;
/** Debajo de esta frecuencia, la nota es del bajo. */
const BASS_HZ = 131;

export class Music {
  #ctx: AudioContext | null = null;
  /** Lo que suena antes de los efectos de master. */
  #master: GainNode | null = null;
  /** Envío a la sala. */
  #send: GainNode | null = null;
  #reverb: ConvolverNode | null = null;
  #timer: number | null = null;
  #mood: Mood;
  #noise: AudioBuffer | null = null;
  #voices = 0;

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

    // Master: lo que sale de las voces y de la sala, con una compresión suave que empasta,
    // un poco de aire arriba, y un limitador al final para que nada distorsione.
    const master = ctx.createGain();
    master.gain.value = 0;
    master.gain.linearRampToValueAtTime(this.#volume, ctx.currentTime + 2);

    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -20;
    glue.knee.value = 12;
    glue.ratio.value = 2.5;
    glue.attack.value = 0.03;
    glue.release.value = 0.25;

    const air = ctx.createBiquadFilter();
    air.type = "highshelf";
    air.frequency.value = 6000;
    air.gain.value = 2;

    // Lo que retumba debajo de 35 Hz no se oye y le come lugar al resto.
    const rumble = ctx.createBiquadFilter();
    rumble.type = "highpass";
    rumble.frequency.value = 35;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;

    master.connect(rumble);
    rumble.connect(glue);
    glue.connect(air);
    air.connect(limiter);
    limiter.connect(ctx.destination);

    // La sala: una reverberación por convolución, no un eco que repite cada nota. El envío
    // va al master, después de su volumen, así el volumen general la incluye.
    const reverb = ctx.createConvolver();
    const send = ctx.createGain();
    const wet = ctx.createGain();
    wet.gain.value = 1;
    send.connect(reverb);
    reverb.connect(wet);
    wet.connect(rumble);

    this.#ctx = ctx;
    this.#master = master;
    this.#send = send;
    this.#reverb = reverb;
    this.#noise = noiseBuffer(ctx);
    this.#room();

    await this.#load(this.#mood.id);
    this.#origin = ctx.currentTime + 0.2;
    this.#schedule();
  }

  stop(): void {
    if (this.#timer) window.clearInterval(this.#timer);
    this.#timer = null;
    const ctx = this.#ctx;
    const master = this.#master;
    const send = this.#send;
    this.#ctx = null;
    this.#master = null;
    this.#send = null;
    this.#reverb = null;
    this.#notes = [];
    if (!ctx || !master) return;
    for (const g of [master, send]) {
      if (!g) continue;
      g.gain.cancelScheduledValues(ctx.currentTime);
      g.gain.setValueAtTime(g.gain.value, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
    }
    window.setTimeout(() => void ctx.close(), 900);
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
    this.#room();

    this.#cursor = 0;
    this.#origin = ctx.currentTime + 0.1;
    master.gain.linearRampToValueAtTime(this.#volume, ctx.currentTime + 1.2);
  }

  /** Sube la intensidad. Se llama cuando una viñeta trae un efecto fuerte. */
  accent(amount = 1): void {
    this.#heat = Math.min(1, this.#heat + amount);
  }

  /** La sala del mood: su respuesta y cuánto se le manda. */
  #room(): void {
    const ctx = this.#ctx;
    if (!ctx || !this.#reverb || !this.#send) return;
    const { seconds, wet } = this.#mood.music.room;
    this.#reverb.buffer = impulse(ctx, seconds);
    this.#send.gain.setValueAtTime(wet, ctx.currentTime);
  }

  async #load(id: string): Promise<void> {
    if (this.#loading === id) return;
    this.#loading = id;
    try {
      const res = await fetch(asset(`/music/${id}.mid`));
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
            midi: n.midi,
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
      if (at >= ctx.currentTime && this.#voices < MAX_VOICES) {
        if (note.drum) this.#drum(at, note);
        else if (note.freq < BASS_HZ) this.#bass(at, note);
        else this.#voice(at, note);
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

  /**
   * La salida de una voz: un paneo según la altura —graves al centro, agudos repartidos—, al
   * master y a la sala. Cuenta la voz mientras suena.
   */
  #out(node: AudioNode, at: number, end: number, freq: number, send = 1): void {
    const ctx = this.#ctx!;
    const pan = ctx.createStereoPanner();
    // Pseudoaleatorio pero estable por nota: la misma nota cae siempre en el mismo lugar.
    const spread = Math.min(1, Math.max(0, (Math.log2(freq / 110) - 0.5) / 3));
    pan.pan.value = Math.sin(freq * 12.9898) * 0.55 * spread;
    node.connect(pan);
    pan.connect(this.#master!);
    if (send > 0 && this.#send) {
      const s = ctx.createGain();
      s.gain.value = send;
      pan.connect(s);
      s.connect(this.#send);
    }
    this.#voices++;
    window.setTimeout(() => this.#voices--, Math.max(0, (end - ctx.currentTime) * 1000) + 50);
  }

  #voice(at: number, note: Note): void {
    switch (this.#mood.music.instrument) {
      case "keys":
        return this.#keys(at, note);
      case "pad":
        return this.#pad(at, note);
      case "strings":
        return this.#strings(at, note);
      case "brass":
        return this.#brass(at, note);
    }
  }

  /**
   * Piano eléctrico, a la manera de un Rhodes: síntesis FM con un modulador a la misma
   * frecuencia cuyo índice cae —el ataque brilla y se apaga en un tono redondo— y un
   * segundo modulador agudo y breve que da el "tin" del golpe.
   */
  #keys(at: number, note: Note): void {
    const ctx = this.#ctx!;
    const { freq, velocity } = note;
    const dur = Math.max(note.duration, 0.15);
    const release = 0.6;
    const end = at + dur + release;

    const carrier = ctx.createOscillator();
    carrier.frequency.value = freq;

    const mod = ctx.createOscillator();
    mod.frequency.value = freq;
    const modGain = ctx.createGain();
    const index = freq * (1.2 + 2.2 * velocity + 1.5 * this.#heat);
    modGain.gain.setValueAtTime(index, at);
    modGain.gain.exponentialRampToValueAtTime(index * 0.12, at + 1.4);
    mod.connect(modGain);
    modGain.connect(carrier.frequency);

    const tine = ctx.createOscillator();
    tine.frequency.value = freq * 14;
    const tineGain = ctx.createGain();
    tineGain.gain.setValueAtTime(freq * 0.9 * velocity, at);
    tineGain.gain.exponentialRampToValueAtTime(0.001, at + 0.06);
    tine.connect(tineGain);
    tineGain.connect(carrier.frequency);

    // Un poco de trémolo, como el de los Rhodes con chorus: le da vida a las notas largas.
    const amp = ctx.createGain();
    const level = 0.36 * (0.35 + 0.65 * velocity) * this.#mood.music.weight;
    amp.gain.setValueAtTime(0, at);
    amp.gain.linearRampToValueAtTime(level, at + 0.006);
    amp.gain.exponentialRampToValueAtTime(level * 0.45, at + Math.min(dur, 1.6));
    amp.gain.setValueAtTime(level * 0.45, at + dur);
    amp.gain.exponentialRampToValueAtTime(0.0001, end);

    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = Math.min(9000, this.#mood.music.bright * 3 + 2600 * this.#heat + 1500 * velocity);

    carrier.connect(amp);
    amp.connect(tone);
    this.#out(tone, at, end, freq);
    for (const o of [carrier, mod, tine]) {
      o.start(at);
      o.stop(end + 0.05);
    }
  }

  /** Pad: tres sierras apenas desafinadas, filtradas y con ataque y cola largos. */
  #pad(at: number, note: Note): void {
    const ctx = this.#ctx!;
    const { freq, velocity } = note;
    const dur = Math.max(note.duration, 0.6);
    const attack = Math.min(0.9, dur * 0.5);
    const release = 1.6;
    const end = at + dur + release;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = this.#mood.music.bright + 900 * this.#heat + 300 * velocity;
    filter.Q.value = 0.3;

    const amp = ctx.createGain();
    const level = 0.07 * (0.5 + 0.5 * velocity) * this.#mood.music.weight;
    amp.gain.setValueAtTime(0, at);
    amp.gain.linearRampToValueAtTime(level, at + attack);
    amp.gain.setValueAtTime(level, at + dur);
    amp.gain.linearRampToValueAtTime(0, end);

    const oscs = [-7, 0, 7].map((cents) => {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = freq;
      o.detune.value = cents;
      o.connect(filter);
      return o;
    });
    // Un seno una octava abajo, muy bajo, le da cuerpo sin ensuciar.
    const sub = ctx.createOscillator();
    sub.frequency.value = freq / 2;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.35;
    sub.connect(subGain);
    subGain.connect(filter);

    filter.connect(amp);
    this.#out(amp, at, end, freq, 1.4);
    for (const o of [...oscs, sub]) {
      o.start(at);
      o.stop(end + 0.05);
    }
  }

  /** Cuerdas: dos sierras desafinadas, ataque suave y un vibrato que entra de a poco. */
  #strings(at: number, note: Note): void {
    const ctx = this.#ctx!;
    const { freq, velocity } = note;
    const dur = Math.max(note.duration, 0.25);
    const attack = Math.min(0.28, dur * 0.4);
    const release = 0.7;
    const end = at + dur + release;

    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 5.2;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, at);
    depth.gain.linearRampToValueAtTime(freq * 0.004, at + 0.45);
    vibrato.connect(depth);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = this.#mood.music.bright + 1200 + 1800 * this.#heat + 800 * velocity;
    filter.Q.value = 0.5;

    const amp = ctx.createGain();
    const level = 0.075 * (0.45 + 0.55 * velocity) * this.#mood.music.weight;
    amp.gain.setValueAtTime(0, at);
    amp.gain.linearRampToValueAtTime(level, at + attack);
    amp.gain.setValueAtTime(level, at + dur);
    amp.gain.exponentialRampToValueAtTime(0.0001, end);

    const oscs = [-9, 9].map((cents) => {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = freq;
      o.detune.value = cents;
      depth.connect(o.frequency);
      o.connect(filter);
      return o;
    });
    filter.connect(amp);
    this.#out(amp, at, end, freq, 1.2);
    for (const o of [...oscs, vibrato]) {
      o.start(at);
      o.stop(end + 0.05);
    }
  }

  /** Bronces: sierra con un filtro que se abre de golpe al atacar y se asienta. */
  #brass(at: number, note: Note): void {
    const ctx = this.#ctx!;
    const { freq, velocity } = note;
    const dur = Math.max(note.duration, 0.12);
    const release = 0.3;
    const end = at + dur + release;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 1.2;
    const peak = this.#mood.music.bright + 2400 * velocity + 2000 * this.#heat;
    filter.frequency.setValueAtTime(350, at);
    filter.frequency.exponentialRampToValueAtTime(peak, at + 0.05);
    filter.frequency.exponentialRampToValueAtTime(peak * 0.55, at + 0.35);

    const amp = ctx.createGain();
    const level = 0.062 * (0.4 + 0.6 * velocity) * this.#mood.music.weight;
    amp.gain.setValueAtTime(0, at);
    amp.gain.linearRampToValueAtTime(level, at + 0.025);
    amp.gain.setValueAtTime(level * 0.8, at + dur);
    amp.gain.exponentialRampToValueAtTime(0.0001, end);

    const a = ctx.createOscillator();
    a.type = "sawtooth";
    a.frequency.value = freq;
    const b = ctx.createOscillator();
    b.type = "square";
    b.frequency.value = freq;
    b.detune.value = 6;
    const bGain = ctx.createGain();
    bGain.gain.value = 0.4;
    a.connect(filter);
    b.connect(bGain);
    bGain.connect(filter);
    filter.connect(amp);
    this.#out(amp, at, end, freq, 0.8);
    for (const o of [a, b]) {
      o.start(at);
      o.stop(end + 0.05);
    }
  }

  /** Bajo: seno con un poco de armónico, redondo, al centro y casi sin sala. */
  #bass(at: number, note: Note): void {
    const ctx = this.#ctx!;
    const { freq, velocity } = note;
    const dur = Math.max(note.duration, 0.15);
    const end = at + dur + 0.25;

    const amp = ctx.createGain();
    const level = 0.22 * (0.5 + 0.5 * velocity) * this.#mood.music.weight;
    amp.gain.setValueAtTime(0, at);
    amp.gain.linearRampToValueAtTime(level, at + 0.012);
    amp.gain.exponentialRampToValueAtTime(level * 0.7, at + Math.min(dur, 0.5));
    amp.gain.setValueAtTime(level * 0.7, at + dur);
    amp.gain.exponentialRampToValueAtTime(0.0001, end);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 500 + 600 * this.#heat;

    const o = ctx.createOscillator();
    o.frequency.value = freq;
    const t = ctx.createOscillator();
    t.type = "triangle";
    t.frequency.value = freq * 2;
    const tGain = ctx.createGain();
    tGain.gain.value = 0.25;
    o.connect(filter);
    t.connect(tGain);
    tGain.connect(filter);
    filter.connect(amp);
    this.#out(amp, at, end, 110, 0.15);
    for (const x of [o, t]) {
      x.start(at);
      x.stop(end + 0.05);
    }
  }

  /** Percusión según el mapa estándar de MIDI: bombo, redoblante, hi-hats y platillos. */
  #drum(at: number, note: Note): void {
    const ctx = this.#ctx!;
    const level = note.velocity * this.#mood.music.drive * 0.65;
    if (level <= 0.01) return;
    const m = note.midi;

    if (m === 35 || m === 36) {
      // Bombo: seno que cae de tono rápido, con un clic corto arriba.
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(140, at);
      o.frequency.exponentialRampToValueAtTime(45, at + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.9 * level, at);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
      o.connect(g);
      this.#out(g, at, at + 0.5, 60, 0.05);
      o.start(at);
      o.stop(at + 0.5);
      return;
    }

    const noise = this.#noise;
    if (!noise) return;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    const g = ctx.createGain();
    let length = 0.1;
    let send = 0.3;

    if (m === 38 || m === 40 || m === 37 || m === 39) {
      // Redoblante: ruido de banda media más un cuerpo tonal breve.
      filter.type = "bandpass";
      filter.frequency.value = 1900;
      filter.Q.value = 0.7;
      length = 0.2;
      g.gain.setValueAtTime(0.5 * level, at);
      const body = ctx.createOscillator();
      body.type = "triangle";
      body.frequency.setValueAtTime(220, at);
      body.frequency.exponentialRampToValueAtTime(160, at + 0.08);
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.3 * level, at);
      bg.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
      body.connect(bg);
      this.#out(bg, at, at + 0.15, 200, 0.3);
      body.start(at);
      body.stop(at + 0.15);
    } else if (m === 42 || m === 44 || m === 46) {
      // Hi-hat: ruido agudo; abierto (46) suena más.
      filter.type = "highpass";
      filter.frequency.value = 7500;
      length = m === 46 ? 0.32 : 0.05;
      g.gain.setValueAtTime(0.22 * level, at);
      send = 0.15;
    } else if (m === 49 || m === 51 || m === 52 || m === 55 || m === 57 || m === 59) {
      // Platillos: ruido brillante y largo.
      filter.type = "highpass";
      filter.frequency.value = 5000;
      length = m === 51 || m === 59 ? 0.5 : 1.4;
      g.gain.setValueAtTime(0.18 * level, at);
      send = 0.5;
    } else {
      // Toms y el resto: un golpe tonal a la altura de la nota.
      const o = ctx.createOscillator();
      const f = 80 + (m - 40) * 9;
      o.frequency.setValueAtTime(f * 1.6, at);
      o.frequency.exponentialRampToValueAtTime(f, at + 0.1);
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(0.45 * level, at);
      tg.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
      o.connect(tg);
      this.#out(tg, at, at + 0.35, f, 0.3);
      o.start(at);
      o.stop(at + 0.35);
      return;
    }
    g.gain.exponentialRampToValueAtTime(0.0001, at + length);
    src.connect(filter);
    filter.connect(g);
    this.#out(g, at, at + length + 0.05, 4000, send);
    src.start(at);
    src.stop(at + length + 0.05);
  }
}

/** Un segundo de ruido blanco, para la percusión. */
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/**
 * La respuesta de una sala, generada: ruido estéreo que se apaga de forma exponencial y se
 * va oscureciendo —en una sala real los agudos se apagan antes—, con un primer tramo
 * silencioso que separa el sonido directo del rebote.
 */
function impulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const predelay = Math.floor(rate * 0.018);
  const buffer = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let low = 0;
    for (let i = predelay; i < length; i++) {
      const t = (i - predelay) / (length - predelay);
      const decay = Math.pow(1 - t, 2.2) * Math.exp(-3 * t);
      // Un pasabajos de un polo que se cierra con el tiempo: la cola se oscurece.
      const k = 0.55 - 0.45 * t;
      low += k * (Math.random() * 2 - 1 - low);
      data[i] = low * decay;
    }
  }
  return buffer;
}

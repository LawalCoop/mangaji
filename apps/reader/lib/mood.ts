/**
 * Registro de lectura: qué tan enfática es la puesta en escena.
 *
 * El manifest describe *qué* pasa en cada viñeta —su cámara, su efecto, su ritmo— y el
 * mood decide con cuánta intensidad se ejecuta. Así el mismo archivo se puede leer tranquilo
 * o al palo, sin reprocesar nada.
 */

export type MoodId = "zen" | "chill" | "tense" | "war";

export type Mood = {
  id: MoodId;
  label: string;
  /** Multiplica la fuerza de los efectos. En 0 no se dispara ninguno. */
  fx: number;
  /** Multiplica las duraciones: >1 respira, <1 corta seco. */
  pace: number;
  /** Cuánto se destaca la viñeta activa sobre el resto de la página. */
  focus: { shade: number; blur: number };
  /** Paleta del acompañamiento sonoro. */
  music: {
    /** Semitonos sobre la tónica; el orden marca el carácter del modo. */
    scale: number[];
    /** Tónica en Hz. */
    root: number;
    /** Segundos entre acordes. */
    step: number;
    /** Cuánto pesa el registro grave. */
    weight: number;
    /** Pulso percusivo, de 0 a 1. */
    drive: number;
    /** Timbre: cuanto más rica la onda, más áspero suena. */
    wave: OscillatorType;
    /** Apertura del filtro en Hz. Bajo = velado y lejano; alto = presente y filoso. */
    bright: number;
    /** Con qué instrumento suena la melodía y la armonía. */
    instrument: "pad" | "keys" | "strings" | "brass";
    /** La sala: cuánto dura la reverberación, en segundos, y cuánto se oye. */
    room: { seconds: number; wet: number };
  };
};

export const MOODS: Record<MoodId, Mood> = {
  zen: {
    id: "zen",
    label: "Zen",
    fx: 0,
    pace: 1.5,
    focus: { shade: 0.06, blur: 2 },
    // Pentatónica mayor: no tiene semitonos, así que ningún acorde suena a tensión.
    // Seno y filtro cerrado: casi sin armónicos, suena lejano.
    music: {
      scale: [0, 2, 4, 7, 9],
      root: 174.61,
      step: 6.5,
      weight: 0.5,
      drive: 0,
      wave: "sine",
      bright: 700,
      instrument: "pad",
      room: { seconds: 3.6, wet: 0.34 },
    },
  },
  chill: {
    id: "chill",
    label: "Chill",
    fx: 0.55,
    pace: 1.15,
    focus: { shade: 0.11, blur: 3 },
    music: {
      scale: [0, 2, 3, 7, 9],
      root: 164.81,
      step: 4.5,
      weight: 0.7,
      drive: 0.1,
      wave: "triangle",
      bright: 1200,
      instrument: "keys",
      room: { seconds: 2.2, wet: 0.2 },
    },
  },
  tense: {
    id: "tense",
    label: "Tenso",
    fx: 1,
    pace: 0.9,
    focus: { shade: 0.18, blur: 5 },
    // Menor con segunda menor: el semitono de arriba es lo que pone el nervio.
    music: {
      scale: [0, 1, 3, 7, 8],
      root: 146.83,
      step: 3.2,
      weight: 0.9,
      drive: 0.35,
      wave: "sawtooth",
      bright: 900,
      instrument: "strings",
      room: { seconds: 2.8, wet: 0.24 },
    },
  },
  war: {
    id: "war",
    label: "Guerra",
    fx: 1.7,
    pace: 0.62,
    focus: { shade: 0.26, blur: 7 },
    // Sierra abierta y una octava más abajo: áspero y presente.
    music: {
      scale: [0, 1, 5, 6, 7],
      root: 110,
      step: 2.1,
      weight: 1,
      drive: 0.85,
      wave: "sawtooth",
      bright: 2200,
      instrument: "brass",
      room: { seconds: 1.7, wet: 0.14 },
    },
  },
};

export const MOOD_ORDER: MoodId[] = ["zen", "chill", "tense", "war"];
export const DEFAULT_MOOD: MoodId = "chill";

/**
 * Los tiempos de una viñeta: cuándo entra y cuándo aparece cada globo.
 *
 * Aparte del pipeline porque los usa también el corrector del portal: al pasar un globo de
 * viñeta o reordenarlos, los tiempos se recalculan con las mismas reglas.
 */

export const ENTER_MS = 450;
export const REVEAL_MS = 300;
export const TAIL_MS = 600;

/**
 * Cuánto se deja leer cada globo antes del siguiente, según cuánto texto tiene.
 *
 * Antes iba de 0,65 a 2,8 s y entre dos globos de la misma viñeta pasaba 1,5 s en el caso
 * típico: con el dedo, esperando, se sentía lento. Se lee más rápido de lo que se escribe.
 */
const READ_MS = { min: 250, max: 1600 };
const READ_SCALE = 160_000;

export const readMs = (ink: number) =>
  Math.round(Math.min(Math.max(READ_MS.min + ink * READ_SCALE, READ_MS.min), READ_MS.max));

type Beat = Record<string, unknown>;

/**
 * Los beats de revelado para estos globos, en este orden, después de la entrada de la
 * viñeta, y la pausa final. Los globos sin sprite no se revelan: no tienen texto propio.
 */
export function revealBeats(balloons: { id: string; sprite: string; inkArea: number }[]): Beat[] {
  const beats: Beat[] = [];
  let t = ENTER_MS;
  for (const balloon of balloons) {
    if (!balloon.sprite) continue;
    beats.push({ t, ms: REVEAL_MS, reveal: balloon.id });
    t += REVEAL_MS + readMs(balloon.inkArea);
  }
  beats.push({ t, ms: 0, hold: TAIL_MS });
  return beats;
}

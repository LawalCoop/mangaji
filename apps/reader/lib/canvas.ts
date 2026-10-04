/**
 * Lienzos 2D en memoria del procesador, no en la placa de video.
 *
 * Chrome acelera los lienzos 2D con la placa, y leerlos o subirlos como textura obliga a
 * esperar a que la placa termine lo que tiene en cola. Mientras la IA corre en WebGPU, esa
 * espera podía trabar la página entera la primera vez que se abría un tomo —"la página no
 * responde", sin nada en la consola—. Los lienzos que se usan son chicos o se leen enseguida:
 * en el procesador cuestan poco y no dependen de que la placa se desocupe.
 */
export const CPU_2D: CanvasRenderingContext2DSettings = { willReadFrequently: true };

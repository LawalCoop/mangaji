/**
 * Cuántas páginas alrededor de la actual se guardan decodificadas, en memoria y en la placa.
 *
 * Una página de manga son entre 2 y 4 megapíxeles: unos 8 a 16 MB decodificada, y otro tanto
 * como textura. Cinco para cada lado eran más de cien MB en un tomo grande, y en el celular
 * el navegador empieza a liberar y volver a decodificar a los tirones, o cierra la pestaña.
 *
 * Con pantalla táctil se guardan sobre todo las que vienen: para atrás casi no se vuelve, y
 * para adelante a veces se pasa rápido. En la compu, que tiene de sobra, cinco y cinco.
 */
const touch = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

export const PAGES = touch ? { behind: 1, ahead: 4, prefetch: 3 } : { behind: 5, ahead: 5, prefetch: 2 };

/** Si una página quedó lejos de la que se lee y se puede soltar. */
export function outOfReach(page: number, current: number): boolean {
  return page < current - PAGES.behind || page > current + PAGES.ahead;
}

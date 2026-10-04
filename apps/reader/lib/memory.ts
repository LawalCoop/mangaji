/**
 * Cuántas páginas a cada lado de la actual se guardan decodificadas, en memoria y en la placa.
 *
 * Una página de manga son entre 2 y 4 megapíxeles: unos 8 a 16 MB decodificada, y otro tanto
 * como textura. Cinco para cada lado eran más de cien MB en un tomo grande, y en el celular
 * el navegador empieza a liberar y volver a decodificar a los tirones, o cierra la pestaña.
 * Con pantalla táctil, dos: alcanza para ir y volver sin esperas.
 */
export const PAGE_SPAN =
  typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches ? 2 : 5;

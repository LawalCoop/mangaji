/**
 * Qué entradas de un archivo son páginas, y en qué orden.
 *
 * Vive separado del worker para poder testearse en Node: es lógica pura y es donde se
 * rompen los CBZ reales (basura de macOS, metadatos, y sobre todo el orden).
 */

const IMAGE_RE = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;

/** Entradas que traen muchos CBZ y no son páginas. */
export function isJunk(name: string): boolean {
  const base = name.split("/").pop() ?? "";
  return (
    name.startsWith("__MACOSX/") ||
    base.startsWith("._") ||
    base === ".DS_Store" ||
    base === "Thumbs.db"
  );
}

export function isPage(name: string): boolean {
  return !name.endsWith("/") && IMAGE_RE.test(name) && !isJunk(name);
}

/**
 * "10.jpg" va después de "9.jpg". El orden lexicográfico —el que sale por defecto— los
 * intercala mal y desordena el capítulo entero.
 */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function sortPages(names: string[]): string[] {
  return [...names].sort(collator.compare);
}

export function selectPages(names: string[]): string[] {
  return sortPages(names.filter(isPage));
}

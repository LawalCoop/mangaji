/**
 * Abrir un tomo desde un link.
 *
 * La app no tiene servidor, así que el navegador baja el archivo directo del sitio donde
 * está. Eso solo funciona si ese sitio lo permite (cabeceras CORS), y la mayoría de los
 * links "para compartir" no apuntan al archivo sino a una página que lo muestra. Por eso
 * primero se traduce el link al de descarga directa de cada servicio, y lo que no se puede
 * bajar se explica en vez de fallar con un error de red.
 *
 * Probado contra cada servicio:
 * - Dropbox: `dl.dropboxusercontent.com` permite la descarga; `www.dropbox.com` no.
 * - GitHub: `raw.githubusercontent.com` sí; `github.com/.../raw/...` redirige sin permiso.
 * - Google Drive: sus links no lo permiten. Haría falta su API con una clave propia.
 *
 * Los errores salen como `ProblemError` con un código: los explica la interfaz, en el
 * idioma que esté puesto.
 */

import { ProblemError } from "./notes";

const DRIVE_HOSTS = new Set(["drive.google.com", "docs.google.com", "drive.usercontent.google.com"]);

/**
 * Convierte un link compartido en el de descarga directa del archivo.
 *
 * Lanza `ProblemError` si el link no sirve.
 */
export function resolveLink(input: string): string {
  const text = input.trim();
  if (!text) throw new ProblemError({ code: "linkEmpty" });

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw new ProblemError({ code: "linkInvalid" });
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ProblemError({ code: "linkInvalid" });
  }

  const host = url.hostname.toLowerCase();

  if (DRIVE_HOSTS.has(host)) throw new ProblemError({ code: "linkDrive" });

  // Dropbox: el mismo camino, en el dominio que sirve el archivo. `dl` sobra ahí; `rlkey`
  // y compañía son los que autorizan el acceso y se conservan.
  if (host === "www.dropbox.com" || host === "dropbox.com") {
    url.hostname = "dl.dropboxusercontent.com";
    url.searchParams.delete("dl");
    url.searchParams.delete("raw");
    return url.toString();
  }

  // GitHub: `usuario/repo/blob|raw/rama/ruta` vive en raw.githubusercontent.com.
  if (host === "github.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 5 && (parts[2] === "blob" || parts[2] === "raw")) {
      const [user, repo, , ...rest] = parts;
      return `https://raw.githubusercontent.com/${user}/${repo}/${rest.join("/")}`;
    }
  }

  return url.toString();
}

/** Nombre del archivo: el que manda el servidor, o el último tramo del link. */
export function fileNameOf(url: string, disposition: string | null): string {
  if (disposition) {
    // `filename*` trae la versión codificada, con acentos y todo; tiene prioridad.
    const star = /filename\*\s*=\s*(?:UTF-8|utf-8)?''([^;]+)/.exec(disposition);
    if (star) {
      try {
        return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
      } catch {
        // Mal codificado: se prueba con el nombre simple.
      }
    }
    const plain = /filename\s*=\s*"?([^";]+)"?/.exec(disposition);
    if (plain) return plain[1].trim();
  }

  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    if (last) return decodeURIComponent(last);
  } catch {
    // Link raro: queda el nombre genérico.
  }
  return "tomo";
}

export type DownloadProgress = { received: number; total: number | null };

/**
 * Baja el archivo avisando el progreso: un tomo son cien megas o más, y desde el celular
 * sin progreso parece colgado.
 */
export async function download(
  url: string,
  onProgress: (p: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<File> {
  let res: Response;
  try {
    res = await fetch(url, { mode: "cors", signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    // El navegador no distingue "no hay red" de "el sitio no lo permite": los dos llegan
    // como el mismo error. Lo segundo es lo que pasa casi siempre.
    throw new ProblemError({ code: navigator.onLine === false ? "offline" : "linkBlocked" });
  }

  if (res.status === 404) throw new ProblemError({ code: "linkMissing" });
  if (res.status === 401 || res.status === 403) throw new ProblemError({ code: "linkPrivate" });
  if (!res.ok) throw new ProblemError({ code: "linkHttp", status: res.status });

  // Un link a la página del archivo en vez de al archivo: se bajaría el HTML.
  if ((res.headers.get("content-type") ?? "").includes("text/html")) {
    throw new ProblemError({ code: "linkPage" });
  }

  const name = fileNameOf(res.url || url, res.headers.get("content-disposition"));
  const length = Number(res.headers.get("content-length"));
  const total = Number.isFinite(length) && length > 0 ? length : null;

  if (!res.body) {
    const blob = await res.blob();
    onProgress({ received: blob.size, total: blob.size });
    return new File([blob], name);
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  onProgress({ received, total });
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress({ received, total });
  }
  return new File(chunks as BlobPart[], name);
}

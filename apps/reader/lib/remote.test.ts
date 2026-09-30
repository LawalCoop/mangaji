import { describe, expect, it } from "vitest";
import { ProblemError, type Problem } from "./notes";
import { fileNameOf, resolveLink } from "./remote";

/** El código con el que `resolveLink` rechaza un link. */
function rejection(link: string): Problem["code"] | null {
  try {
    resolveLink(link);
    return null;
  } catch (err) {
    return err instanceof ProblemError ? err.problem.code : null;
  }
}

describe("links compartidos a descarga directa", () => {
  it("Dropbox pasa al dominio que sirve el archivo, sin `dl` y con su clave", () => {
    expect(
      resolveLink("https://www.dropbox.com/scl/fi/abc123/Tomo%2049.cbz?rlkey=xyz&st=q1&dl=0"),
    ).toBe("https://dl.dropboxusercontent.com/scl/fi/abc123/Tomo%2049.cbz?rlkey=xyz&st=q1");
    expect(resolveLink("https://www.dropbox.com/s/abc123/tomo.cbr?dl=0")).toBe(
      "https://dl.dropboxusercontent.com/s/abc123/tomo.cbr",
    );
  });

  it("GitHub pasa a raw.githubusercontent.com", () => {
    expect(resolveLink("https://github.com/ana/mangas/blob/main/tomos/uno.cbz")).toBe(
      "https://raw.githubusercontent.com/ana/mangas/main/tomos/uno.cbz",
    );
    expect(resolveLink("https://github.com/ana/mangas/raw/main/uno.cbz")).toBe(
      "https://raw.githubusercontent.com/ana/mangas/main/uno.cbz",
    );
  });

  it("un link directo queda como está, y sin protocolo se asume https", () => {
    expect(resolveLink("  https://ejemplo.com/tomo.cbz ")).toBe("https://ejemplo.com/tomo.cbz");
    expect(resolveLink("ejemplo.com/tomo.cbz")).toBe("https://ejemplo.com/tomo.cbz");
  });

  it("Google Drive se explica en vez de fallar con un error de red", () => {
    expect(rejection("https://drive.google.com/file/d/1abc/view?usp=sharing")).toBe("linkDrive");
  });

  it("lo que no es un link se rechaza con un mensaje", () => {
    expect(rejection("")).toBe("linkEmpty");
    expect(rejection("hola que tal")).toBe("linkInvalid");
    expect(rejection("ftp://ejemplo.com/tomo.cbz")).toBe("linkInvalid");
  });
});

describe("nombre del archivo bajado", () => {
  it("prefiere el nombre codificado que manda el servidor", () => {
    expect(
      fileNameOf(
        "https://x.com/dl",
        `attachment; filename="Tomo 49.cbz"; filename*=UTF-8''Tomo%2049%20%C3%B1.cbz`,
      ),
    ).toBe("Tomo 49 ñ.cbz");
  });

  it("si no, usa el nombre simple", () => {
    expect(fileNameOf("https://x.com/dl", 'attachment; filename="uno.cbr"')).toBe("uno.cbr");
  });

  it("sin cabecera, sale del último tramo del link", () => {
    expect(fileNameOf("https://x.com/a/Tomo%2049.cbz?rlkey=1", null)).toBe("Tomo 49.cbz");
    expect(fileNameOf("https://x.com/", null)).toBe("tomo");
  });
});

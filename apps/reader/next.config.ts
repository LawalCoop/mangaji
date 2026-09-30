import type { NextConfig } from "next";

/**
 * Publicación estática para GitHub Pages. Se activa con `STATIC_EXPORT=1`.
 *
 * Con el dominio propio (mangaji.lawal.coop) la app vive en la raíz. Si alguna vez se
 * publica bajo una ruta —como `lawalcoop.github.io/mangaji/`—, esa ruta va en
 * `NEXT_PUBLIC_BASE_PATH`, y todo lo que se pide a mano la lleva (ver lib/base.ts).
 */
const staticExport = process.env.STATIC_EXPORT === "1";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

/**
 * Aislamiento de origen.
 *
 * Sin esto el navegador no entrega memoria compartida y onnxruntime cae a un solo hilo, que
 * es la diferencia entre que el respaldo sin GPU sea lento o inusable. `credentialless` en
 * vez de `require-corp` para que las tipografías de Google sigan cargando sin cabeceras
 * propias.
 *
 * En la exportación estática no hay servidor que mande cabeceras: ahí las agrega
 * `coi-serviceworker`, que carga el layout.
 */
const nextConfig: NextConfig = staticExport
  ? { output: "export", basePath, trailingSlash: true, images: { unoptimized: true } }
  : {
      async headers() {
        return [
          {
            source: "/:path*",
            headers: [
              { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
              { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
            ],
          },
        ];
      },
    };

export default nextConfig;

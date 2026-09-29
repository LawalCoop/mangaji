import type { NextConfig } from "next";

/**
 * Publicación estática para GitHub Pages, que sirve la app bajo `/<repo>/`. Se activa
 * definiendo `NEXT_PUBLIC_BASE_PATH`; sin ella, la app corre en la raíz como siempre.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH;

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
const nextConfig: NextConfig = basePath
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

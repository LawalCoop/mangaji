import type { NextConfig } from "next";

/**
 * Aislamiento de origen.
 *
 * Sin esto el navegador no entrega memoria compartida y onnxruntime cae a un solo hilo, que
 * es la diferencia entre que el respaldo sin GPU sea lento o inusable. `credentialless` en
 * vez de `require-corp` para que las tipografías de Google sigan cargando sin cabeceras
 * propias.
 */
const nextConfig: NextConfig = {
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

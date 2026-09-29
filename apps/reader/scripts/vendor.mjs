/**
 * Copia a `public/` los runtimes que el navegador pide por URL y no pasan por el bundler:
 * los `.wasm` de onnxruntime y el worker de libarchive. Salen de `node_modules`, así que
 * siempre coinciden con la versión instalada y no hace falta versionarlos.
 */
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = (name) => join(root, "node_modules", name);

function copy(from, to, keep) {
  mkdirSync(to, { recursive: true });
  for (const file of readdirSync(from)) {
    if (keep(file)) copyFileSync(join(from, file), join(to, file));
  }
}

copy(join(pkg("onnxruntime-web"), "dist"), join(root, "public/ort"), (f) => /\.(mjs|wasm)$/.test(f));
copy(
  join(pkg("libarchive.js"), "dist"),
  join(root, "public/libarchive"),
  (f) => f === "worker-bundle.js" || f === "libarchive.wasm",
);
copy(pkg("coi-serviceworker"), join(root, "public"), (f) => f === "coi-serviceworker.min.js");

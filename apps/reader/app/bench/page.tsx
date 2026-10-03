"use client";

import { useCallback, useRef, useState } from "react";
import { asset } from "../../lib/base";

/**
 * Banco de pruebas del pipeline en el navegador.
 *
 * Mide lo único que decide si el procesamiento puede vivir en el cliente: cuánto tarda cada
 * modelo por página, con WebGPU y con WASM. Todo lo demás del pipeline —máscaras, orden de
 * lectura, extracción del diálogo— es trabajo de CPU que ya sabemos que es barato; el costo
 * está en la inferencia.
 */

const MODELS = {
  panels: { url: asset("/models/panels.onnx"), label: "Viñetas (segmentación)", mb: 42 },
  text: { url: asset("/models/text.onnx"), label: "Diálogo (detección)", mb: 10 },
} as const;

const SIZE = 1280;

type Row = {
  model: string;
  backend: string;
  load: number;
  first: number;
  median: number;
  note?: string;
};

export default function Bench() {
  const [rows, setRows] = useState<Row[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [webgpu, setWebgpu] = useState<boolean | null>(null);
  const image = useRef<ImageData | null>(null);
  const [imageName, setImageName] = useState("");

  const say = (line: string) => setLog((l) => [...l, line]);

  /**
   * Toma una página del archivo y la prepara como el pipeline: escalada a 1280 con relleno,
   * sin deformar.
   *
   * De un CBZ se saca una página del medio: la portada suele ser una ilustración a sangre y
   * no representa lo que el detector va a encontrar en el resto del tomo.
   */
  const loadImage = useCallback(async (file: File) => {
    let bitmap: ImageBitmap;

    if (/\.(cbz|cbza|zip)$/i.test(file.name)) {
      const { CbzSource } = await import("../../lib/archive");
      const source = await CbzSource.open(file);
      const index = Math.floor(source.pageCount / 2);
      bitmap = await source.bitmap(index);
      setImageName(`${file.name} · página ${index + 1} de ${source.pageCount}`);
      say(`${file.name}: ${source.pageCount} páginas, se usa la ${index + 1}`);
    } else {
      bitmap = await createImageBitmap(file);
      setImageName(`${file.name} · ${bitmap.width}×${bitmap.height}`);
      say(`imagen lista: ${file.name}`);
    }

    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = "#727272";
    ctx.fillRect(0, 0, SIZE, SIZE);
    const scale = Math.min(SIZE / bitmap.width, SIZE / bitmap.height);
    ctx.drawImage(bitmap, 0, 0, bitmap.width * scale, bitmap.height * scale);
    image.current = ctx.getImageData(0, 0, SIZE, SIZE);
  }, []);

  const run = useCallback(async () => {
    if (!image.current) return;
    setRunning(true);
    setRows([]);
    setLog([]);

    const ort = await import("onnxruntime-web");
    ort.env.wasm.wasmPaths = asset("/ort/");
    ort.env.wasm.numThreads = navigator.hardwareConcurrency ?? 4;
    // Avisa que las operaciones de forma van a CPU en vez de a la GPU. Es deliberado —ahí
    // son más rápidas—, pero el overlay de desarrollo lo muestra como si fuera un error.
    ort.env.logLevel = "error";

    const hasGpu = "gpu" in navigator && Boolean(await (navigator as any).gpu?.requestAdapter());
    setWebgpu(hasGpu);
    say(hasGpu ? "WebGPU disponible" : "WebGPU no disponible: solo WASM");

    // El tensor de entrada es el mismo para todas las corridas: se arma una sola vez.
    const { data } = image.current;
    const chw = new Float32Array(3 * SIZE * SIZE);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      chw[p] = data[i] / 255;
      chw[SIZE * SIZE + p] = data[i + 1] / 255;
      chw[2 * SIZE * SIZE + p] = data[i + 2] / 255;
    }
    const tensor = new ort.Tensor("float32", chw, [1, 3, SIZE, SIZE]);

    const backends = hasGpu ? (["webgpu", "wasm"] as const) : (["wasm"] as const);

    for (const backend of backends) {
      for (const [key, model] of Object.entries(MODELS)) {
        say(`${model.label} · ${backend}: cargando…`);
        try {
          const t0 = performance.now();
          const session = await ort.InferenceSession.create(model.url, {
            executionProviders: [backend],
            graphOptimizationLevel: "all",
            logSeverityLevel: 3,
          });
          const load = performance.now() - t0;

          const feeds = { [session.inputNames[0]]: tensor };
          const t1 = performance.now();
          await session.run(feeds);
          const first = performance.now() - t1;

          // La primera corrida incluye compilación de kernels; las siguientes son la medida real.
          const times: number[] = [];
          for (let i = 0; i < 4; i++) {
            const t = performance.now();
            await session.run(feeds);
            times.push(performance.now() - t);
          }
          times.sort((a, b) => a - b);

          setRows((r) => [
            ...r,
            { model: model.label, backend, load, first, median: times[times.length >> 1] },
          ]);
          say(`${model.label} · ${backend}: ${Math.round(times[times.length >> 1])} ms`);
          await session.release();
        } catch (err) {
          setRows((r) => [
            ...r,
            {
              model: model.label,
              backend,
              load: 0,
              first: 0,
              median: 0,
              note: (err as Error).message.slice(0, 120),
            },
          ]);
          say(`${model.label} · ${backend}: FALLÓ`);
        }
      }
    }

    setRunning(false);
  }, []);

  const perPage = (backend: string) =>
    rows.filter((r) => r.backend === backend && r.median).reduce((sum, r) => sum + r.median, 0);

  return (
    <main className="mx-auto min-h-dvh max-w-3xl p-8 text-neutral-200">
      <h1 className="mb-1 text-2xl font-bold">Banco de pruebas</h1>
      <p className="mb-6 text-sm text-neutral-400">
        Mide cuánto tarda cada modelo por página en este navegador. Elegí un CBZ —se usa una
        página del medio, que representa mejor el tomo que la portada— o una imagen suelta.
      </p>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <label className="cursor-pointer rounded border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-900">
          Elegir CBZ o página
          <input
            type="file"
            accept=".cbz,.cbza,.cbr,.zip,.rar,image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void loadImage(f);
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => void run()}
          disabled={!imageName || running}
          className="rounded bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 disabled:opacity-40"
        >
          {running ? "Midiendo…" : "Medir"}
        </button>
        {imageName && <span className="text-xs text-neutral-500">{imageName}</span>}
      </div>

      {rows.length > 0 && (
        <table className="mb-6 w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="py-2">Modelo</th>
              <th>Backend</th>
              <th className="text-right">Carga</th>
              <th className="text-right">1.ª</th>
              <th className="text-right">Mediana</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-neutral-800">
                <td className="py-2">{r.model}</td>
                <td>{r.backend}</td>
                <td className="text-right">{r.note ? "—" : `${Math.round(r.load)} ms`}</td>
                <td className="text-right">{r.note ? "—" : `${Math.round(r.first)} ms`}</td>
                <td className="text-right font-bold">
                  {r.note ? <span className="text-red-400">falló</span> : `${Math.round(r.median)} ms`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {rows.length > 0 && (
        <div className="mb-6 space-y-1 rounded border border-neutral-800 p-4 text-sm">
          <p className="mb-2 text-xs uppercase tracking-wide text-neutral-500">
            Los dos modelos, por página
          </p>
          {["webgpu", "wasm"].map((b) => {
            const total = perPage(b);
            if (!total) return null;
            return (
              <p key={b}>
                <span className="inline-block w-20 text-neutral-400">{b}</span>
                <span className="font-bold">{(total / 1000).toFixed(2)} s</span>
                <span className="text-neutral-500">
                  {" "}
                  · capítulo de 19 páginas: {((total * 19) / 1000 / 60).toFixed(1)} min · tomo de
                  210: {((total * 210) / 1000 / 60).toFixed(0)} min
                </span>
              </p>
            );
          })}
          {webgpu === false && (
            <p className="pt-2 text-xs text-amber-400">
              Sin WebGPU en este navegador. El pipeline en el cliente depende de él para ser
              usable.
            </p>
          )}
        </div>
      )}

      <pre className="whitespace-pre-wrap text-xs leading-relaxed text-neutral-500">
        {log.join("\n")}
      </pre>
    </main>
  );
}

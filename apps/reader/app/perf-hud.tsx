"use client";

import { useEffect, useState } from "react";
import { perf } from "../lib/perf";

/**
 * El tablero del diagnóstico (`?perf=on`): cuadros por segundo, tirones, en qué anda la IA,
 * y el botón para copiar el informe y mandarlo.
 */
export function PerfHud() {
  const [live, setLive] = useState(perf.live());
  const [copied, setCopied] = useState<"no" | "yes" | "failed">("no");
  const [text, setText] = useState<string | null>(null);

  useEffect(() => perf.subscribe(() => setLive(perf.live())), []);

  const copy = async () => {
    const report = perf.report();
    try {
      await navigator.clipboard.writeText(report);
      setCopied("yes");
    } catch {
      // Sin permiso para el portapapeles: se muestra para copiarlo a mano.
      setCopied("failed");
      setText(report);
    }
  };

  return (
    <div className="pointer-events-auto fixed left-2 top-2 z-50 max-w-[calc(100vw-1rem)] rounded bg-black/75 px-2 py-1.5 font-mono text-[11px] leading-tight text-white">
      <div>
        {live.fps} cps · {live.janks} tirones · {live.seconds}s
      </div>
      <div>IA: {live.ai ?? "quieta"}{live.heap !== null && ` · ${live.heap} MB`}</div>
      {live.panels && <div>viñetas: {live.panels}</div>}
      <button type="button" onClick={copy} className="mt-1 rounded bg-white/20 px-2 py-0.5">
        {copied === "yes" ? "Informe copiado" : "Copiar informe"}
      </button>
      {text && (
        <textarea
          readOnly
          value={text}
          onFocus={(e) => e.currentTarget.select()}
          className="mt-1 block h-32 w-64 bg-white text-[10px] text-black"
        />
      )}
    </div>
  );
}

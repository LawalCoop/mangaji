"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CbzSource } from "@/lib/archive";
import { Camera } from "@/lib/camera";
import { Director } from "@/lib/director";
import { PageFrameSource } from "@/lib/frame-sources";
import { Stage } from "@/lib/stage";

/** Hasta que la página se decodifica no se sabe su tamaño; esto evita un encuadre en cero. */
const ASSUMED_PAGE = { w: 1600, h: 2300 };

type Status = { kind: "idle" } | { kind: "loading" } | { kind: "ready" } | { kind: "error"; message: string };

export default function ReaderView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engine = useRef<{
    source: CbzSource;
    stage: Stage;
    director: Director;
    sizes: { w: number; h: number }[];
    dispose: () => void;
  } | null>(null);

  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [label, setLabel] = useState("");
  const [title, setTitle] = useState("");

  const teardown = useCallback(() => {
    engine.current?.dispose();
    engine.current = null;
  }, []);

  useEffect(() => teardown, [teardown]);

  const open = useCallback(
    async (file: File) => {
      teardown();
      setStatus({ kind: "loading" });
      setTitle(file.name);

      try {
        const canvas = canvasRef.current;
        if (!canvas) throw new Error("Canvas no disponible");

        const source = await CbzSource.open(file);
        const sizes = Array.from({ length: source.pageCount }, () => ({ ...ASSUMED_PAGE }));
        const frames = new PageFrameSource(sizes);
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const director = new Director(frames, { reducedMotion });
        const stage = await Stage.create(canvas);

        // Cada cambio de encuadre pide su página; `token` descarta las respuestas que
        // llegan tarde cuando el lector ya avanzó.
        let token = 0;
        const draw = async (immediate: boolean) => {
          const mine = ++token;
          const frame = director.frame;
          setLabel(director.label);

          source.prefetch(frame.page + 1);
          source.prefetch(frame.page + 2);

          try {
            const bitmap = await source.bitmap(frame.page);
            if (mine !== token) return;

            sizes[frame.page] = { w: bitmap.width, h: bitmap.height };
            const fresh = director.frame;
            stage.show(fresh, bitmap);

            const fit = Camera.fit(fresh.rect, stage.viewport);
            immediate || director.reducedMotion ? stage.camera.cut(fit) : stage.camera.glide(fit, 220);
            stage.render();
          } catch (err) {
            if (mine === token) setStatus({ kind: "error", message: (err as Error).message });
          }
        };

        const offDirector = director.on((ev) => {
          if (ev.type === "frame") void draw(ev.immediate);
        });

        const offTick = stage.onTick((dt) => {
          director.tick(dt);
          stage.camera.update(dt);
          stage.render();
        });

        const onResize = () => {
          const fit = Camera.fit(director.frame.rect, stage.viewport);
          stage.camera.cut(fit);
          stage.render();
        };
        window.addEventListener("resize", onResize);

        engine.current = {
          source,
          stage,
          director,
          sizes,
          dispose: () => {
            window.removeEventListener("resize", onResize);
            offTick();
            offDirector();
            stage.destroy();
            source.close();
          },
        };

        setStatus({ kind: "ready" });
        void draw(true);
      } catch (err) {
        setStatus({ kind: "error", message: (err as Error).message });
      }
    },
    [teardown],
  );

  // Teclado. Manga se lee derecha→izquierda: la flecha izquierda avanza.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const eng = engine.current;
      if (!eng) return;
      switch (e.key) {
        case "ArrowLeft":
        case " ":
        case "PageDown":
          e.preventDefault();
          eng.director.next();
          break;
        case "ArrowRight":
        case "PageUp":
          e.preventDefault();
          eng.director.prev();
          break;
        case "f":
          eng.stage.camera.cut(Camera.fit(eng.director.frame.rect, eng.stage.viewport));
          break;
        case "Home":
          eng.director.seek(0);
          break;
        case "End":
          eng.director.seek(eng.director.length - 1);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files?.[0];
      if (file) void open(file);
    },
    [open],
  );

  // Paneo con arrastre; un click limpio avanza o retrocede según la mitad de pantalla.
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!engine.current) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const eng = engine.current;
    if (!d || !eng) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    eng.stage.camera.nudge(dx, dy);
    d.x = e.clientX;
    d.y = e.clientY;
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    const eng = engine.current;
    drag.current = null;
    if (!d || !eng || d.moved) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // Mitad izquierda = siguiente, por la dirección de lectura del manga.
    e.clientX - rect.left < rect.width / 2 ? eng.director.next() : eng.director.prev();
  };

  const onWheel = (e: React.WheelEvent) => {
    const eng = engine.current;
    if (!eng) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    eng.stage.camera.zoomAt(
      e.deltaY < 0 ? 1.12 : 1 / 1.12,
      e.clientX - rect.left,
      e.clientY - rect.top,
    );
  };

  return (
    <main
      className="relative h-dvh w-dvw overflow-hidden bg-neutral-950 text-neutral-200"
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <div
        className="absolute inset-0 touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        onWheel={onWheel}
      >
        <canvas ref={canvasRef} className="block h-full w-full" />
      </div>

      {status.kind !== "ready" && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center p-8">
          <div className="pointer-events-auto max-w-md text-center">
            <h1 className="mb-2 text-2xl font-semibold tracking-tight">Manganime</h1>
            <p className="mb-6 text-sm text-neutral-400">
              {status.kind === "loading"
                ? "Abriendo…"
                : status.kind === "error"
                  ? status.message
                  : "Soltá un archivo CBZ acá, o elegilo."}
            </p>
            <label className="cursor-pointer rounded-md border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-900">
              Elegir CBZ
              <input
                type="file"
                accept=".cbz,.zip,application/zip"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void open(file);
                }}
              />
            </label>
            <p className="mt-6 text-xs text-neutral-600">
              Nada se sube a ningún servidor: el archivo se abre en tu navegador.
            </p>
          </div>
        </div>
      )}

      {status.kind === "ready" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-4 bg-gradient-to-t from-black/70 to-transparent p-4 text-xs text-neutral-400">
          <span className="truncate">{title}</span>
          <span className="tabular-nums">{label}</span>
        </div>
      )}
    </main>
  );
}

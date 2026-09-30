"use client";

import { useEffect, useRef, useState } from "react";
import type { Messages } from "@/lib/i18n";
import { PANELS, type Pt } from "../reading-demo";
import { CYAN, INK, MAGENTA, PAPER } from "../site";

/**
 * Las escenas de "cómo funciona": una animación por etapa del pipeline.
 *
 * Cada escena es una secuencia de pasos. Avanza sola solo mientras está a la vista —fuera de
 * pantalla no gasta nada— y con movimiento reducido se queda en el último paso, que es el
 * que muestra el resultado.
 */

const W = 320;
const H = 240;
const GRAY = "#727272";
const MUTED = "#6E6E78";

type Labels = Messages["how"]["scene"];

/** Paso actual de una escena, y si hay que animar las transiciones. */
function useSteps(holds: number[]) {
  const ref = useRef<HTMLDivElement>(null);
  const last = holds.length - 1;
  // El HTML estático sale con el resultado final: sin JavaScript, o antes de hidratar, se
  // ve lo que la escena explica.
  const [step, setStep] = useState(last);
  const [motion, setMotion] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: ReturnType<typeof setTimeout> | null = null;
    let visible = false;
    let current = 0;

    const stop = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const run = () => {
      stop();
      if (!visible || reduced.matches) return;
      timer = setTimeout(() => {
        current = current >= last ? 0 : current + 1;
        setStep(current);
        run();
      }, holds[current]);
    };
    const sync = () => {
      setMotion(!reduced.matches);
      if (reduced.matches) setStep(last);
      run();
    };

    const io = new IntersectionObserver(([entry]) => {
      const was = visible;
      visible = entry.isIntersecting;
      // Al entrar en pantalla la escena arranca desde el principio.
      if (visible && !was && !reduced.matches) {
        current = 0;
        setStep(0);
      }
      run();
    }, { threshold: 0.35 });
    if (ref.current) io.observe(ref.current);
    reduced.addEventListener("change", sync);
    sync();
    return () => {
      stop();
      io.disconnect();
      reduced.removeEventListener("change", sync);
    };
    // Las duraciones son constantes de cada escena.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ref, step, motion };
}

const EASE = "cubic-bezier(0.65, 0, 0.25, 1)";

/** Estilo de una capa que aparece según el paso. */
function show(visible: boolean, motion: boolean, ms = 450, delay = 0): React.CSSProperties {
  return {
    opacity: visible ? 1 : 0,
    transition: motion ? `opacity ${ms}ms ${EASE} ${delay}ms` : undefined,
  };
}

/** Transformación animada de un grupo SVG. */
function move(transform: string, motion: boolean, ms = 800, delay = 0): React.CSSProperties {
  return {
    transform,
    transformBox: "view-box",
    transformOrigin: "0 0",
    transition: motion ? `transform ${ms}ms ${EASE} ${delay}ms, opacity 400ms ${EASE} ${delay}ms` : undefined,
  };
}

function Frame({
  children,
  label,
  sceneRef,
}: {
  children: React.ReactNode;
  label: string;
  sceneRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div ref={sceneRef} className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={label}>
        {children}
      </svg>
    </div>
  );
}

const points = (poly: Pt[]) => poly.map((p) => p.join(",")).join(" ");

/** Una hoja chiquita con viñetas, para cuando la escena necesita "una página". */
function MiniPage({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={PAPER} />
      <g transform={`translate(${x} ${y}) scale(${w / 300} ${h / 420})`}>
        {PANELS.map((poly, i) => (
          <polygon key={i} points={points(poly)} fill="none" stroke={INK} strokeWidth={6} />
        ))}
      </g>
    </g>
  );
}

/* 1 · Abrir el archivo --------------------------------------------------------------- */

export function OpenScene({ label, t }: { label: string; t: Labels }) {
  const { ref, step, motion } = useSteps([900, 1500, 2600]);
  // Las páginas salen desordenadas del archivo y se acomodan por nombre.
  const shuffled = [3, 0, 4, 1, 2];
  return (
    <Frame sceneRef={ref} label={label}>
      <g>
        <rect x="24" y="72" width="76" height="96" fill={INK} stroke={PAPER} strokeWidth="2.5" />
        {Array.from({ length: 6 }, (_, i) => (
          <rect key={i} x={i % 2 ? 58 : 62} y={80 + i * 8} width="6" height="6" fill={PAPER} />
        ))}
        <text x="62" y="190" textAnchor="middle" fontSize="13" fill={PAPER} style={{ fontFamily: "var(--body)", fontWeight: 700 }}>
          .cbz · .cbr
        </text>
      </g>
      {Array.from({ length: 5 }, (_, i) => {
        const slot = shuffled.indexOf(i);
        const at =
          step === 0
            ? `translate(46px, 96px) scale(0.6)`
            : step === 1
              ? `translate(${128 + slot * 36}px, ${58 + (slot % 2) * 58}px) rotate(${(slot - 2) * 5}deg)`
              : `translate(${126 + i * 38}px, 88px)`;
        return (
          <g key={i} style={{ ...move(at, motion, 750, i * 60), opacity: step === 0 ? 0 : 1 }}>
            <rect width="30" height="42" fill={PAPER} stroke={INK} strokeWidth="2" />
            <path d="M 4 5 H 26 M 4 20 H 26 M 16 5 V 38" stroke={INK} strokeWidth="1.5" />
            <text x="15" y="58" textAnchor="middle" fontSize="12" fill={PAPER} style={{ fontFamily: "var(--body)", fontWeight: 700 }}>
              {i + 1}
            </text>
          </g>
        );
      })}
      <text x="222" y="190" textAnchor="middle" fontSize="12" fill={MUTED} style={{ ...show(step === 2, motion), fontFamily: "var(--body)" }}>
        {t.pages} 1 → 5
      </text>
    </Frame>
  );
}

/* 2 · Preparar la página ------------------------------------------------------------- */

export function PrepareScene({ label }: { label: string }) {
  const { ref, step, motion } = useSteps([1100, 1700, 2600]);
  const planes = [
    { color: "#FF4D4D", name: "R" },
    { color: "#3DDC84", name: "G" },
    { color: "#4D8DFF", name: "B" },
  ];
  return (
    <Frame sceneRef={ref} label={label}>
      {/* El cuadrado de entrada, con el relleno gris donde no llega la hoja. */}
      <g style={show(step >= 1, motion)}>
        <rect x="40" y="40" width="150" height="150" fill={GRAY} />
        <text x="115" y="214" textAnchor="middle" fontSize="13" fill={PAPER} style={{ fontFamily: "var(--body)", fontWeight: 700 }}>
          1280 × 1280
        </text>
      </g>
      <g style={move(step === 0 ? "translate(70px, 20px) scale(1)" : "translate(40px, 40px) scale(0.75)", motion, 900)}>
        <MiniPage x={0} y={0} w={143} h={200} />
      </g>
      <rect x="40" y="40" width="150" height="150" fill="none" stroke={CYAN} strokeWidth="2.5" strokeDasharray="6 4" style={show(step >= 1, motion)} />

      {/* Los tres planos de color: lo que realmente entra a la red. */}
      {planes.map((p, i) => (
        <g key={p.name} style={{ ...move(`translate(${step === 2 ? 212 + i * 16 : 150}px, ${step === 2 ? 56 + i * 16 : 70}px)`, motion, 700, i * 90), opacity: step === 2 ? 1 : 0 }}>
          <rect width="72" height="72" fill={p.color} fillOpacity="0.28" stroke={p.color} strokeWidth="2" />
          <text x="62" y="66" textAnchor="end" fontSize="13" fill={p.color} style={{ fontFamily: "var(--body)", fontWeight: 700 }}>
            {p.name}
          </text>
        </g>
      ))}
    </Frame>
  );
}

/* 3 · Dos redes neuronales miran ----------------------------------------------------- */

export function DetectScene({ label, t }: { label: string; t: Labels }) {
  const { ref, step, motion } = useSteps([700, 1500, 3000]);
  const s = 0.5;
  const ox = 30;
  const oy = 15;
  const box = (poly: Pt[]) => {
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    return { x: ox + Math.min(...xs) * s, y: oy + Math.min(...ys) * s, w: (Math.max(...xs) - Math.min(...xs)) * s, h: (Math.max(...ys) - Math.min(...ys)) * s };
  };
  const balloons = [
    { x: ox + 160 * s, y: oy + 25 * s, w: 60 * s, h: 34 * s },
    { x: ox + 18 * s, y: oy + 24 * s, w: 60 * s, h: 40 * s },
    { x: ox + 74 * s, y: oy + 297 * s, w: 68 * s, h: 38 * s },
  ];
  const legend = [
    { color: CYAN, name: t.panel, conf: "0.98", dash: undefined },
    { color: MAGENTA, name: t.balloon, conf: "0.97", dash: undefined },
    { color: PAPER, name: t.text, conf: "0.66", dash: "4 3" },
  ];
  return (
    <Frame sceneRef={ref} label={label}>
      <MiniPage x={ox} y={oy} w={150} h={210} />
      {/* Dos modelos, dos pasadas: una línea que recorre la hoja. */}
      <rect
        x={ox - 4}
        width="158"
        height="3"
        fill={CYAN}
        style={{
          transform: `translateY(${step === 1 ? oy + 210 : oy}px)`,
          transition: motion && step === 1 ? "transform 1400ms linear" : undefined,
          opacity: step === 1 ? 1 : 0,
        }}
      />
      <g style={show(step === 2, motion, 400)}>
        {PANELS.map((poly, i) => {
          const b = box(poly);
          return <rect key={i} x={b.x + 2} y={b.y + 2} width={b.w - 4} height={b.h - 4} fill="none" stroke={CYAN} strokeWidth="2" />;
        })}
        {balloons.map((b, i) => (
          <g key={i}>
            <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="none" stroke={MAGENTA} strokeWidth="2" />
            <rect x={b.x + 4} y={b.y + 5} width={b.w - 8} height={b.h - 10} fill="none" stroke={PAPER} strokeWidth="1.5" strokeDasharray="3 2" />
          </g>
        ))}
      </g>
      {legend.map((l, i) => (
        <g key={l.name} style={show(step === 2, motion, 400, 150 + i * 150)}>
          <rect x="204" y={70 + i * 36} width="16" height="16" fill="none" stroke={l.color} strokeWidth="2.5" strokeDasharray={l.dash} />
          <text x="228" y={83 + i * 36} fontSize="13" fill={PAPER} style={{ fontFamily: "var(--body)", fontWeight: 700 }}>
            {l.name}
          </text>
          <text x="300" y={83 + i * 36} textAnchor="end" fontSize="12" fill={MUTED} style={{ fontFamily: "var(--body)" }}>
            {l.conf}
          </text>
        </g>
      ))}
    </Frame>
  );
}

/* 4 · De la mancha al polígono ------------------------------------------------------- */

const TRAPEZOID: Pt[] = [
  [96, 44],
  [236, 34],
  [244, 196],
  [84, 206],
];

function inside([x, y]: Pt, poly: Pt[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** La máscara binaria, a la resolución gruesa de los prototipos: celdas de 12 px. */
const CELL = 12;
const CELLS = (() => {
  const out: Pt[] = [];
  for (let y = 24; y < 220; y += CELL) {
    for (let x = 72; x < 256; x += CELL) {
      if (inside([x + CELL / 2, y + CELL / 2], TRAPEZOID)) out.push([x, y]);
    }
  }
  return out;
})();

/** El contorno escalonado de esas celdas: los lados que no tienen vecina. */
const STAIRS = (() => {
  const has = new Set(CELLS.map(([x, y]) => `${x},${y}`));
  let d = "";
  for (const [x, y] of CELLS) {
    if (!has.has(`${x},${y - CELL}`)) d += `M${x} ${y}H${x + CELL}`;
    if (!has.has(`${x},${y + CELL}`)) d += `M${x} ${y + CELL}H${x + CELL}`;
    if (!has.has(`${x - CELL},${y}`)) d += `M${x} ${y}V${y + CELL}`;
    if (!has.has(`${x + CELL},${y}`)) d += `M${x + CELL} ${y}V${y + CELL}`;
  }
  return d;
})();

export function PolygonScene({ label }: { label: string }) {
  const { ref, step, motion } = useSteps([1500, 1300, 1300, 1300, 2600]);
  return (
    <Frame sceneRef={ref} label={label}>
      <defs>
        <radialGradient id="scene-blob">
          <stop offset="0" stopColor={PAPER} stopOpacity="0.95" />
          <stop offset="0.6" stopColor={PAPER} stopOpacity="0.55" />
          <stop offset="1" stopColor={PAPER} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* 32 prototipos, cada uno con su peso: se muestran unos pocos. */}
      <g style={show(step === 0, motion)}>
        {[0, 1, 2, 3].map((i) => (
          <g key={i} transform={`translate(${40 + i * 66} 70)`}>
            <rect width="52" height="52" fill="#1C1C22" />
            <ellipse cx={14 + ((i * 11) % 26)} cy={18 + ((i * 7) % 20)} rx={16 + i * 2} ry={12 + (i % 2) * 6} fill="url(#scene-blob)" />
            <text x="26" y="72" textAnchor="middle" fontSize="12" fill={MUTED} style={{ fontFamily: "var(--body)" }}>
              × {["0.8", "−0.3", "1.2", "0.5"][i]}
            </text>
          </g>
        ))}
        <text x="160" y="190" textAnchor="middle" fontSize="13" fill={PAPER} style={{ fontFamily: "var(--body)", fontWeight: 700 }}>
          32 × 160 × 160
        </text>
      </g>

      {/* La mezcla: una mancha difusa con la forma de la viñeta. */}
      <polygon points={points(TRAPEZOID)} fill={PAPER} fillOpacity="0.55" style={{ ...show(step === 1, motion), filter: "blur(9px)" }} />

      {/* Umbral al 50 %: celdas encendidas o apagadas. */}
      <g style={show(step >= 2 && step <= 3, motion)}>
        {CELLS.map(([x, y]) => (
          <rect key={`${x},${y}`} x={x + 1} y={y + 1} width={CELL - 2} height={CELL - 2} fill={PAPER} fillOpacity={step === 3 ? 0.25 : 0.85} />
        ))}
      </g>
      <path d={STAIRS} stroke={CYAN} strokeWidth="2.5" fill="none" style={show(step === 3, motion)} />

      {/* El resultado: lados rectos y cuatro vértices. */}
      <g style={show(step === 4, motion)}>
        <polygon points={points(TRAPEZOID)} fill={PAPER} fillOpacity="0.12" stroke={MAGENTA} strokeWidth="3" strokeLinejoin="round" />
        {TRAPEZOID.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="5" fill={MAGENTA} />
        ))}
      </g>
    </Frame>
  );
}

/* 5 · El orden de lectura ------------------------------------------------------------ */

export function OrderScene({ label }: { label: string }) {
  const { ref, step, motion } = useSteps([900, 1500, 1500, 3200]);
  const s = 0.54;
  const ox = (W - 300 * s) / 2 - 40;
  const oy = (H - 420 * s) / 2;
  const at = (x: number, y: number) => [ox + x * s, oy + y * s] as const;
  // Cortes en coordenadas de la hoja: primero las filas, después las columnas de cada una.
  const rows = [167, 283];
  const cols = [
    { x: 151, y0: 12, y1: 167 },
    { x: 157, y0: 283, y1: 408 },
  ];
  const centers: Pt[] = [
    [224, 86],
    [80, 90],
    [150, 222],
    [224, 346],
    [80, 350],
  ];
  const draw = (visible: boolean, delay = 0): React.CSSProperties => ({
    strokeDasharray: 400,
    strokeDashoffset: visible ? 0 : 400,
    transition: motion ? `stroke-dashoffset 700ms ${EASE} ${delay}ms` : undefined,
  });
  return (
    <Frame sceneRef={ref} label={label}>
      <MiniPage x={ox} y={oy} w={300 * s} h={420 * s} />
      {rows.map((y, i) => {
        const [x0, yy] = at(0, y);
        const [x1] = at(300, y);
        return <line key={y} x1={x0 - 10} y1={yy} x2={x1 + 10} y2={yy} stroke={MAGENTA} strokeWidth="3" style={draw(step >= 1, i * 200)} />;
      })}
      {cols.map((c, i) => {
        const [x, y0] = at(c.x, c.y0);
        const [, y1] = at(c.x, c.y1);
        return <line key={i} x1={x} y1={y0} x2={x} y2={y1} stroke={CYAN} strokeWidth="3" style={draw(step >= 2, i * 200)} />;
      })}
      {centers.map(([x, y], i) => {
        const [cx, cy] = at(x, y);
        return (
          <g key={i} style={show(step >= 3, motion, 300, i * 260)}>
            <circle cx={cx} cy={cy} r="13" fill={i === 0 ? MAGENTA : INK} stroke={PAPER} strokeWidth="2" />
            <text x={cx} y={cy + 5} textAnchor="middle" fontSize="14" fill="white" style={{ fontFamily: "var(--font-display)" }}>
              {i + 1}
            </text>
          </g>
        );
      })}
      {/* El sentido, a un costado: de derecha a izquierda. */}
      <g style={show(step >= 3, motion, 400, 1400)}>
        <path d="M 262 120 H 216" stroke={MAGENTA} strokeWidth="3" markerEnd="url(#scene-arrow)" />
        <defs>
          <marker id="scene-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 Z" fill={MAGENTA} />
          </marker>
        </defs>
      </g>
    </Frame>
  );
}

/* 6 · Levantar el diálogo ------------------------------------------------------------ */

export function LiftScene({ label, t }: { label: string; t: Labels }) {
  const { ref, step, motion } = useSteps([1200, 1900, 1600]);
  const lines = [
    [112, 92, 190],
    [104, 106, 198],
    [118, 120, 184],
  ];
  const Text = () => (
    <g stroke={INK} strokeWidth="5" strokeLinecap="round">
      {lines.map(([x1, y, x2]) => (
        <line key={y} x1={x1} y1={y} x2={x2} y2={y} />
      ))}
    </g>
  );
  return (
    <Frame sceneRef={ref} label={label}>
      {/* La viñeta: trama y un globo. */}
      <rect x="20" y="30" width="200" height="180" fill={PAPER} stroke={INK} strokeWidth="3" />
      <g stroke={INK} strokeWidth="1.2" opacity="0.5">
        {Array.from({ length: 12 }, (_, i) => (
          <line key={i} x1={20} y1={150 + i * 6} x2={220} y2={130 + i * 6} />
        ))}
      </g>
      <path d="M 120 146 L 108 176 L 140 146 Z" fill="white" stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
      <ellipse cx="150" cy="106" rx="70" ry="44" fill="white" stroke={INK} strokeWidth="2.5" />

      {/* En la hoja: está, se borra, y vuelve cuando le toca. */}
      <g style={show(step !== 1, motion, 450, step === 2 ? 700 : 0)}>
        <Text />
      </g>

      {/* La capa aparte, que sale del globo. */}
      <g style={{ ...move(step === 1 ? "translate(100px, -56px)" : "translate(0px, 0px)", motion, 900), opacity: step === 1 ? 1 : 0 }}>
        {/* Fondo de papel: sobre la pantalla negra, las letras negras no se verían. */}
        <rect x="92" y="78" width="118" height="56" fill={PAPER} fillOpacity="0.92" stroke={CYAN} strokeWidth="2" strokeDasharray="5 4" />
        <Text />
        <text x="151" y="70" textAnchor="middle" fontSize="12" fill={CYAN} style={{ fontFamily: "var(--body)", fontWeight: 700 }}>
          {t.layer}
        </text>
      </g>
    </Frame>
  );
}

/* 7 · Dirigir cada viñeta ------------------------------------------------------------ */

export function DirectScene({ label, t }: { label: string; t: Labels }) {
  const { ref, step, motion } = useSteps([900, 1400, 3600]);
  const ink = 0.48;
  const blocks = [
    { name: t.camera, ms: 450, color: CYAN },
    { name: t.reveal, ms: 420, color: MAGENTA },
    { name: t.read, ms: 1300, color: "#3A3A44" },
    { name: t.reveal, ms: 420, color: MAGENTA },
    { name: t.read, ms: 900, color: "#3A3A44" },
    { name: t.hold, ms: 600, color: "#26262C" },
  ];
  const total = blocks.reduce((a, b) => a + b.ms, 0);
  const x0 = 24;
  const width = 272;
  let at = x0;
  return (
    <Frame sceneRef={ref} label={label}>
      {/* La viñeta y su medición de tinta. */}
      <g style={{ transformBox: "fill-box", animation: step === 2 && motion ? "scene-shake 0.45s linear 0.35s 2" : undefined }}>
        <defs>
          <clipPath id="scene-direct-panel">
            <rect x="24" y="20" width="150" height="120" />
          </clipPath>
        </defs>
        <rect x="24" y="20" width="150" height="120" fill={PAPER} stroke={INK} strokeWidth="3" />
        <g stroke={INK} strokeWidth="4" clipPath="url(#scene-direct-panel)">
          {Array.from({ length: 16 }, (_, i) => {
            const a = (i / 16) * Math.PI * 2;
            return (
              <line
                key={i}
                x1={Math.round((99 + Math.cos(a) * 16) * 100) / 100}
                y1={Math.round((80 + Math.sin(a) * 12) * 100) / 100}
                x2={Math.round((99 + Math.cos(a) * 90) * 100) / 100}
                y2={Math.round((80 + Math.sin(a) * 70) * 100) / 100}
              />
            );
          })}
        </g>
        <rect x="24" y="20" width="150" height="120" fill="none" stroke={INK} strokeWidth="3" />
      </g>

      <g>
        <text x="206" y="34" fontSize="12" fill={PAPER} style={{ fontFamily: "var(--body)", fontWeight: 700 }}>
          {t.ink}
        </text>
        <rect x="206" y="42" width="18" height="98" fill="none" stroke={PAPER} strokeWidth="2" />
        <rect
          x="208"
          width="14"
          fill={MAGENTA}
          style={{
            y: 138 - 94 * (step >= 1 ? ink : 0),
            height: 94 * (step >= 1 ? ink : 0),
            transition: motion ? `y 900ms ${EASE}, height 900ms ${EASE}` : undefined,
          } as React.CSSProperties}
        />
        {/* Los dos umbrales están a nueve píxeles: una etiqueta arriba y otra abajo. */}
        {[
          { v: 0.52, name: "52 %", dy: -3 },
          { v: 0.42, name: "42 %", dy: 11 },
        ].map((m) => (
          <g key={m.name}>
            <line x1="200" x2="230" y1={138 - 94 * m.v} y2={138 - 94 * m.v} stroke={CYAN} strokeWidth="1.5" />
            <text x="236" y={138 - 94 * m.v + m.dy} fontSize="11" fill={CYAN} style={{ fontFamily: "var(--body)" }}>
              {m.name}
            </text>
          </g>
        ))}
      </g>

      {/* La línea de tiempo de la viñeta: lo que el director ejecuta. */}
      {blocks.map((b, i) => {
        const w = (b.ms / total) * width;
        const x = at;
        at += w;
        return (
          <g key={i} style={show(step >= 1, motion, 300, 120 * i)}>
            <rect x={x} y="168" width={w - 2} height="26" fill={b.color} />
            {w > 36 && (
              <text x={x + 5} y="185" fontSize="10.5" fill={PAPER} style={{ fontFamily: "var(--body)", fontWeight: 700 }}>
                {b.name}
              </text>
            )}
          </g>
        );
      })}
      {/* Los bloques cortos no tienen lugar para su nombre: van en la leyenda. */}
      <g style={show(step >= 1, motion, 300, 700)}>
        {[
          { color: CYAN, name: t.camera },
          { color: MAGENTA, name: t.reveal },
        ].map((l, i) => (
          <g key={l.name} transform={`translate(${x0 + i * 110} 214)`}>
            <rect width="12" height="12" fill={l.color} />
            <text x="18" y="10.5" fontSize="11.5" fill={PAPER} style={{ fontFamily: "var(--body)", fontWeight: 700 }}>
              {l.name}
            </text>
          </g>
        ))}
      </g>
      <rect
        y="160"
        width="3"
        height="42"
        fill="white"
        style={{
          x: step === 2 ? x0 + width : x0,
          transition: motion && step === 2 ? "x 3200ms linear" : undefined,
          opacity: step >= 1 ? 1 : 0,
        } as React.CSSProperties}
      />
    </Frame>
  );
}

/* 8 · Guardarlo en un .cbza ---------------------------------------------------------- */

export function SaveScene({ label }: { label: string }) {
  const { ref, step, motion } = useSteps([800, 3200]);
  const files = ["manifest.json", "pages/p001.webp", "pages/p002.webp", "sprites/p001.b0.png", "sprites/p001.b1.png"];
  return (
    <Frame sceneRef={ref} label={label}>
      <rect x="28" y="64" width="84" height="108" fill={INK} stroke={PAPER} strokeWidth="2.5" />
      {Array.from({ length: 7 }, (_, i) => (
        <rect key={i} x={i % 2 ? 66 : 70} y={72 + i * 8} width="6" height="6" fill={PAPER} />
      ))}
      <text x="70" y="160" textAnchor="middle" fontSize="15" fill={CYAN} style={{ fontFamily: "var(--body)", fontWeight: 700 }}>
        .cbza
      </text>
      {files.map((f, i) => (
        <g key={f} style={show(step === 1, motion, 350, i * 220)}>
          <path d={`M 128 ${76 + i * 24} H 140`} stroke={MUTED} strokeWidth="1.5" />
          <text x="146" y={80 + i * 24} fontSize="13" fill={i === 0 ? MAGENTA : PAPER} style={{ fontFamily: "var(--body)", fontWeight: i === 0 ? 700 : 500 }}>
            {f}
          </text>
        </g>
      ))}
    </Frame>
  );
}

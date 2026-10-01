"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Demo de la portada: lo que hace la app, hecho con una página dibujada.
 *
 * La cámara entra a cada viñeta en orden de lectura —de derecha a izquierda, de arriba
 * abajo—, oscurece el resto de la hoja como el foco del lector, y el globo de cada viñeta
 * aparece recién cuando le toca. Después se abre a la página entera, con el orden numerado,
 * y vuelve a empezar. Reemplaza a explicar el sentido de lectura con palabras.
 *
 * Con movimiento reducido queda quieta en la página entera, y fuera de pantalla se pausa.
 */

const INK = "#0B0B0C";
const PAPER = "#F4EFE3";
const CYAN = "#00D9F5";
const MAGENTA = "#FF2E88";

const W = 300;
const H = 420;

export type Pt = [number, number];

/** Las viñetas, ya en orden de lectura. Los bordes inclinados son paralelos entre sí. */
export const PANELS: Pt[][] = [
  [[160, 12], [288, 12], [288, 148], [152, 160]],
  [[12, 12], [150, 12], [142, 161], [12, 172]],
  [[12, 182], [288, 158], [288, 268], [12, 284]],
  [[166, 285], [288, 278], [288, 408], [158, 408]],
  [[12, 294], [156, 286], [148, 408], [12, 408]],
];

/** Dónde va el número de orden de cada viñeta: arriba a la derecha, que es donde se empieza. */
const BADGES: Pt[] = [
  [272, 30],
  [128, 30],
  [270, 178],
  [270, 300],
  [136, 305],
];

/** Cuánto se queda la cámara en cada paso: primero la página entera, después cada viñeta. */
const HOLD = { page: 2400, panel: 1500, action: 1100 };

/**
 * Dos decimales: el servidor y el navegador no siempre coinciden en el último dígito de un
 * seno, y la diferencia rompe la hidratación.
 */
const round = (v: number) => Math.round(v * 100) / 100;

const points = (poly: Pt[]) => poly.map((p) => p.join(",")).join(" ");

function bounds(poly: Pt[]) {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** La transformación que encuadra una viñeta en la ventana, con un poco de aire. */
function framing(step: number) {
  if (step < 0) return { s: 1, x: 0, y: 0 };
  const b = bounds(PANELS[step]);
  const s = Math.min(W / b.w, H / b.h) * 0.9;
  return { s, x: W / 2 - (b.x + b.w / 2) * s, y: H / 2 - (b.y + b.h / 2) * s };
}

/** Un globo: óvalo con cola y un par de renglones grises en lugar de texto. */
function Balloon({ cx, cy, rx, ry, tail, lines }: { cx: number; cy: number; rx: number; ry: number; tail: Pt; lines: number }) {
  const base = cx + (tail[0] > cx ? 6 : -6);
  return (
    <g>
      <path
        d={`M ${base - 7} ${cy + ry * 0.8} L ${tail[0]} ${tail[1]} L ${base + 7} ${cy + ry * 0.8} Z`}
        fill="white"
        stroke={INK}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="white" stroke={INK} strokeWidth={1.6} />
      {Array.from({ length: lines }, (_, i) => {
        const y = cy - ((lines - 1) * 5) / 2 + i * 5;
        const half = rx * (i === lines - 1 ? 0.35 : 0.55);
        return <line key={i} x1={cx - half} y1={y} x2={cx + half} y2={y} stroke="#9A9AA2" strokeWidth={2.2} strokeLinecap="round" />;
      })}
    </g>
  );
}

export function ReadingDemo({ label, caption }: { label: string; caption: string }) {
  // -1 es la página entera; 0..4, la viñeta enfocada.
  const [step, setStep] = useState(-1);
  const [animate, setAnimate] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let current = -1;

    const stop = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const schedule = () => {
      stop();
      if (!visible || reduced.matches) return;
      const hold = current < 0 ? HOLD.page : current === 2 ? HOLD.action : HOLD.panel;
      timer = setTimeout(() => {
        current = current >= PANELS.length - 1 ? -1 : current + 1;
        setStep(current);
        schedule();
      }, hold);
    };
    const sync = () => {
      setAnimate(!reduced.matches);
      if (reduced.matches) {
        current = -1;
        setStep(-1);
      }
      schedule();
    };

    // Fuera de pantalla no hay nada que mirar: se pausa, que en el celular es batería.
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      schedule();
    });
    if (box.current) io.observe(box.current);
    reduced.addEventListener("change", sync);
    sync();
    return () => {
      stop();
      io.disconnect();
      reduced.removeEventListener("change", sync);
    };
  }, []);

  const f = framing(step);
  const overview = step < 0;
  const ease = "cubic-bezier(0.65, 0, 0.25, 1)";

  return (
    <figure className="flex h-full flex-col justify-center gap-4">
      <div
        ref={box}
        className="demo-sheet relative mx-auto w-full max-w-[360px] overflow-hidden border-[4px] lg:max-w-none"
        style={{ borderColor: INK, background: "#1A1A1E", aspectRatio: `${W} / ${H}` }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-full w-full" role="img" aria-label={label}>
          <defs>
            <pattern id="demo-tone" width="5" height="5" patternUnits="userSpaceOnUse">
              <circle cx="1.5" cy="1.5" r="0.9" fill={INK} fillOpacity="0.28" />
            </pattern>
            {PANELS.map((poly, i) => (
              <clipPath key={i} id={`demo-clip-${i}`}>
                <polygon points={points(poly)} />
              </clipPath>
            ))}
          </defs>

          <g
            style={{
              transformBox: "view-box",
              transformOrigin: "0 0",
              transform: `translate(${f.x}px, ${f.y}px) scale(${f.s})`,
              transition: animate ? `transform 850ms ${ease}` : undefined,
            }}
          >
            <rect width={W} height={H} fill={PAPER} />

            {/* 1 · alguien de espaldas, mirando a la derecha */}
            <g clipPath="url(#demo-clip-0)">
              <rect x="150" y="10" width="140" height="152" fill="url(#demo-tone)" />
              <path d="M 196 160 Q 200 112 232 104 Q 266 112 270 160 Z" fill={INK} />
              <circle cx="233" cy="86" r="21" fill={PAPER} stroke={INK} strokeWidth="2" />
              <path d="M 210 84 L 214 60 L 224 72 L 232 54 L 240 70 L 252 58 L 256 84 Q 233 70 210 84 Z" fill={INK} />
            </g>

            {/* 2 · la otra persona, de frente */}
            <g clipPath="url(#demo-clip-1)">
              <path d="M 40 172 Q 44 124 78 116 Q 112 124 116 172 Z" fill={INK} />
              <circle cx="78" cy="98" r="22" fill={PAPER} stroke={INK} strokeWidth="2" />
              <path d="M 56 96 Q 60 70 78 72 Q 98 70 100 96 Q 90 82 78 86 Q 66 82 56 96 Z" fill={INK} />
              <circle cx="71" cy="101" r="2.2" fill={INK} />
              <circle cx="86" cy="101" r="2.2" fill={INK} />
            </g>

            {/* 3 · el golpe: líneas de velocidad y la onomatopeya */}
            <g clipPath="url(#demo-clip-2)">
              {Array.from({ length: 44 }, (_, i) => {
                const a = (i / 44) * Math.PI * 2;
                const r0 = 30 + (i % 3) * 8;
                return (
                  <line
                    key={i}
                    x1={round(150 + Math.cos(a) * r0)}
                    y1={round(221 + Math.sin(a) * r0 * 0.6)}
                    x2={round(150 + Math.cos(a) * 190)}
                    y2={round(221 + Math.sin(a) * 120)}
                    stroke={INK}
                    strokeWidth={i % 2 ? 1 : 2.2}
                  />
                );
              })}
              <path
                d="M 150 196 L 158 212 L 176 206 L 166 220 L 182 232 L 162 232 L 158 250 L 148 234 L 130 244 L 138 228 L 120 218 L 140 214 Z"
                fill="white"
                stroke={INK}
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <text
                x="226"
                y="248"
                fontSize="30"
                fontWeight="900"
                fill={PAPER}
                stroke={INK}
                strokeWidth="1.6"
                paintOrder="stroke"
                transform="rotate(-8 226 248)"
                style={{ fontFamily: "var(--font-kana)" }}
                textAnchor="middle"
              >
                ドォン
              </text>
            </g>

            {/* 4 · primer plano de los ojos */}
            <g clipPath="url(#demo-clip-3)">
              <rect x="150" y="270" width="140" height="140" fill="url(#demo-tone)" />
              <path d="M 178 340 Q 196 322 214 340 Q 196 350 178 340 Z" fill="white" stroke={INK} strokeWidth="2" />
              <path d="M 230 336 Q 248 318 266 336 Q 248 346 230 336 Z" fill="white" stroke={INK} strokeWidth="2" />
              <circle cx="197" cy="338" r="5" fill={INK} />
              <circle cx="249" cy="334" r="5" fill={INK} />
              <path d="M 176 324 L 214 316 M 232 312 L 268 320" stroke={INK} strokeWidth="3" strokeLinecap="round" />
            </g>

            {/* 5 · la respuesta */}
            <g clipPath="url(#demo-clip-4)">
              <path d="M 40 408 Q 46 368 82 360 Q 118 368 124 408 Z" fill={INK} />
              <circle cx="82" cy="342" r="19" fill={PAPER} stroke={INK} strokeWidth="2" />
              <path d="M 62 340 Q 66 318 82 320 Q 100 318 102 340 Q 92 330 82 332 Q 72 330 62 340 Z" fill={INK} />
            </g>

            {PANELS.map((poly, i) => (
              <polygon key={i} points={points(poly)} fill="none" stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
            ))}

            {/* Los globos aparecen cuando la cámara llega a su viñeta, y quedan. */}
            {[
              <Balloon key={0} cx={190} cy={42} rx={30} ry={17} tail={[214, 70]} lines={2} />,
              <Balloon key={1} cx={48} cy={44} rx={30} ry={20} tail={[64, 76]} lines={3} />,
              null,
              <Balloon key={3} cx={214} cy={380} rx={34} ry={14} tail={[196, 360]} lines={2} />,
              <Balloon key={4} cx={108} cy={316} rx={34} ry={19} tail={[92, 336]} lines={2} />,
            ].map((balloon, i) =>
              balloon ? (
                <g
                  key={i}
                  style={{
                    opacity: !animate || (!overview && step >= i) ? 1 : 0,
                    transition: animate ? "opacity 320ms ease-out 450ms" : undefined,
                  }}
                >
                  {balloon}
                </g>
              ) : null,
            )}

            {/* Foco: el resto de la hoja se apaga, como en el lector. */}
            <path
              d={`M0 0H${W}V${H}H0Z M${PANELS[Math.max(step, 0)].map((p) => p.join(" ")).join("L")}Z`}
              fillRule="evenodd"
              fill={INK}
              style={{
                opacity: overview ? 0 : 0.62,
                transition: animate ? `opacity 400ms ${ease}` : undefined,
              }}
            />

            {/* El orden, a la vista solo con la página entera. */}
            <g style={{ opacity: overview ? 1 : 0, transition: animate ? "opacity 300ms" : undefined }}>
              {BADGES.map(([x, y], i) => (
                <g key={i}>
                  <circle cx={x} cy={y} r="11" fill={i === 0 ? MAGENTA : INK} />
                  <text
                    x={x}
                    y={y + 4.5}
                    textAnchor="middle"
                    fontSize="13"
                    fill="white"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    {i + 1}
                  </text>
                </g>
              ))}
            </g>
          </g>

          {/* Marcas de encuadre fijas: la pantalla, no la hoja. */}
          <g stroke={CYAN} strokeWidth="3" fill="none" style={{ opacity: overview ? 0 : 1, transition: animate ? "opacity 300ms" : undefined }}>
            <path d="M 10 30 V 10 H 30" />
            <path d={`M ${W - 30} 10 H ${W - 10} V 30`} />
            <path d={`M 10 ${H - 30} V ${H - 10} H 30`} />
            <path d={`M ${W - 30} ${H - 10} H ${W - 10} V ${H - 30}`} />
          </g>
        </svg>
      </div>

      <figcaption className="flex items-start gap-3 text-[15px] font-medium leading-snug" style={{ color: PAPER }}>
        <span aria-hidden className="shrink-0 font-[family-name:var(--display)] text-[22px] leading-[0.8]" style={{ color: MAGENTA }}>
          ←
        </span>
        {caption}
      </figcaption>
    </figure>
  );
}

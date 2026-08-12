import { describe, expect, it } from "vitest";
import { Director, frameDuration } from "./director";
import type { Frame, FrameSource } from "./types";

/** Fuente de prueba: `beats` por frame para simular lo que traerán v2 y v4. */
function makeSource(frames: Partial<Frame>[]): FrameSource {
  const built: Frame[] = frames.map((f, i) => ({
    id: f.id ?? `f${i}`,
    page: f.page ?? i,
    rect: f.rect ?? { x: 0, y: 0, w: 100, h: 100 },
    beats: f.beats ?? [],
    ...f,
  }));
  return {
    get length() {
      return built.length;
    },
    at: (i) => built[i],
    label: (i) => `${i + 1} / ${built.length}`,
  };
}

function collect(director: Director) {
  const events: string[] = [];
  director.on((ev) => {
    if (ev.type === "beat") events.push(`beat:${ev.beat.t}`);
    else if (ev.type === "frame") events.push(`frame:${ev.index}`);
    else events.push("end");
  });
  return events;
}

describe("Director", () => {
  it("avanza y retrocede entre encuadres", () => {
    const d = new Director(makeSource([{}, {}, {}]));
    expect(d.index).toBe(0);
    d.next();
    expect(d.index).toBe(1);
    d.prev();
    expect(d.index).toBe(0);
    d.prev();
    expect(d.index).toBe(0);
  });

  it("no se pasa del final y avisa que terminó", () => {
    const d = new Director(makeSource([{}, {}]));
    const events = collect(d);
    d.next();
    d.next();
    expect(d.index).toBe(1);
    expect(events).toContain("end");
  });

  it("dispara los beats en orden a medida que corre el reloj", () => {
    const d = new Director(
      makeSource([{ beats: [{ t: 0, ms: 0 }, { t: 100, ms: 0 }, { t: 500, ms: 0 }] }]),
    );
    const events = collect(d);

    d.tick(50);
    expect(events).toEqual(["beat:0"]);
    d.tick(60); // 110ms
    expect(events).toEqual(["beat:0", "beat:100"]);
    d.tick(1000);
    expect(events).toEqual(["beat:0", "beat:100", "beat:500"]);
  });

  it("el primer avance completa los beats pendientes en vez de saltear el encuadre", () => {
    const d = new Director(makeSource([{ beats: [{ t: 0, ms: 0 }, { t: 9999, ms: 0 }] }, {}]));
    const events = collect(d);

    d.next(); // quedan beats sin disparar: los completa y se queda
    expect(d.index).toBe(0);
    expect(events).toEqual(["beat:0", "beat:9999"]);

    d.next(); // ahora sí avanza
    expect(d.index).toBe(1);
  });

  it("en autoplay avanza solo al terminar la duración del encuadre", () => {
    const d = new Director(makeSource([{ beats: [{ t: 0, ms: 200, hold: 300 }] }, {}]), {
      autoplay: true,
    });
    d.tick(400);
    expect(d.index).toBe(0);
    d.tick(200); // 600 > 500
    expect(d.index).toBe(1);
  });

  it("cambiar de fuente mantiene al lector en la misma página", () => {
    // Modo página: un frame por página. Modo viñeta: varios por página.
    const pages = makeSource([{ page: 0 }, { page: 1 }, { page: 2 }]);
    const panels = makeSource([
      { page: 0 },
      { page: 1 },
      { page: 1 },
      { page: 2 },
      { page: 2 },
    ]);

    const d = new Director(pages);
    d.seek(2);
    d.setSource(panels);
    expect(d.frame.page).toBe(2);
    expect(d.index).toBe(3); // la primera viñeta de esa página
  });
});

describe("frameDuration", () => {
  it("es el final del último beat", () => {
    const frame: Frame = {
      id: "f",
      page: 0,
      rect: { x: 0, y: 0, w: 1, h: 1 },
      beats: [
        { t: 0, ms: 200 },
        { t: 300, ms: 100, hold: 400 },
      ],
    };
    expect(frameDuration(frame, 4000)).toBe(800);
  });

  it("usa el valor por defecto cuando no hay beats", () => {
    const frame: Frame = { id: "f", page: 0, rect: { x: 0, y: 0, w: 1, h: 1 }, beats: [] };
    expect(frameDuration(frame, 4000)).toBe(4000);
  });
});

"""Construcción del `.cbza`: detectar, ordenar y empaquetar."""

from __future__ import annotations

import json
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from . import dialogue
from .archive import Page, read_pages
from .detect import Detector, Detection
from .dialogue import Sprite
from .order import Box, default_tolerance, reading_order

#: Descarta fragmentos espurios: una viñeta real nunca es tan chica.
MIN_PANEL_AREA_RATIO = 0.02
#: Un globo tiene que estar dentro de una viñeta para pertenecerle.
BALLOON_IN_PANEL_RATIO = 0.6


@dataclass(slots=True)
class BuildStats:
    pages: int = 0
    panels: int = 0
    balloons: int = 0
    texts: int = 0
    splashes: int = 0
    #: detecciones descartadas por caer bajo el área mínima
    dropped: int = 0
    #: la misma viñeta o globo detectado más de una vez
    duplicates: int = 0
    #: globos cuyo texto se pudo levantar del arte
    lifted: int = 0
    ms: float = 0.0


#: Dos detecciones que se solapan más que esto son la misma viñeta vista dos veces.
DEDUPE_IOU = 0.6


def _polygon_iou(a: list[tuple[int, int]], b: list[tuple[int, int]], scale: float = 0.125) -> float:
    """Solape real entre dos siluetas.

    Comparar cajas no alcanza: las viñetas de manga son trapecios muy alargados, y dos
    trapecios bien distintos pueden compartir casi la misma caja envolvente. Se rasteriza
    a escala reducida, que para decidir un duplicado sobra y cuesta nada.
    """
    pa = np.array(a, np.float32) * scale
    pb = np.array(b, np.float32) * scale
    pts = np.vstack([pa, pb])
    x0, y0 = pts.min(0) - 1
    x1, y1 = pts.max(0) + 1
    w, h = int(x1 - x0) + 1, int(y1 - y0) + 1
    if w <= 0 or h <= 0:
        return 0.0

    ma = np.zeros((h, w), np.uint8)
    mb = np.zeros((h, w), np.uint8)
    cv2.fillPoly(ma, [(pa - [x0, y0]).astype(np.int32)], 1)
    cv2.fillPoly(mb, [(pb - [x0, y0]).astype(np.int32)], 1)
    union = np.count_nonzero(ma | mb)
    return float(np.count_nonzero(ma & mb) / union) if union else 0.0


def _merge_sprites(sprites: list[Sprite]) -> Sprite:
    """Junta en un solo sprite los bloques de texto de un mismo globo.

    El modelo suele partir un globo en varias regiones de texto (una por párrafo). Para el
    reader es un solo diálogo, y revelarlo entero de una vez es lo que se lee natural.
    """
    if len(sprites) == 1:
        return sprites[0]

    x0 = min(s.bbox[0] for s in sprites)
    y0 = min(s.bbox[1] for s in sprites)
    x1 = max(s.bbox[0] + s.bbox[2] for s in sprites)
    y1 = max(s.bbox[1] + s.bbox[3] for s in sprites)

    canvas = np.zeros((y1 - y0, x1 - x0, 4), np.uint8)
    for s in sprites:
        x, y, w, h = s.bbox
        region = canvas[y - y0 : y - y0 + h, x - x0 : x - x0 + w]
        # Se queda el más opaco de los dos: los bloques no se pisan, pero por si acaso.
        keep = s.rgba[:, :, 3] >= region[:, :, 3]
        region[keep] = s.rgba[keep]

    ink = sum(s.ink * s.bbox[2] * s.bbox[3] for s in sprites) / max(
        (x1 - x0) * (y1 - y0), 1
    )
    return Sprite(rgba=canvas, bbox=(x0, y0, x1 - x0, y1 - y0), ink=ink)


def _dedupe(dets: list[Detection], threshold: float = DEDUPE_IOU) -> list[Detection]:
    """Se queda con la detección más confiable de cada grupo solapado."""
    kept: list[Detection] = []
    for det in sorted(dets, key=lambda d: -d.conf):
        if all(_polygon_iou(det.polygon, k.polygon) < threshold for k in kept):
            kept.append(det)
    return kept


def _inside_polygon(
    polygon: list[tuple[int, int]],
    inner: tuple[float, float, float, float],
    scale: float = 0.25,
) -> float:
    """Fracción de `inner` que cae dentro de la silueta del polígono.

    Contra la caja de la viñeta no sirve: con bordes diagonales las cajas de dos viñetas
    vecinas se pisan, y un globo de una puede puntuar más alto en la de al lado. Entonces
    su diálogo aparecía mientras la cámara encuadraba la viñeta equivocada.
    """
    x, y, w, h = (v * scale for v in inner)
    if w < 1 or h < 1:
        return 0.0

    pts = (np.array(polygon, np.float32) * scale).astype(np.int32)
    x0, y0 = int(min(x, pts[:, 0].min())) - 1, int(min(y, pts[:, 1].min())) - 1
    x1 = int(max(x + w, pts[:, 0].max())) + 1
    y1 = int(max(y + h, pts[:, 1].max())) + 1

    canvas = np.zeros((y1 - y0, x1 - x0), np.uint8)
    cv2.fillPoly(canvas, [pts - [x0, y0]], 1)

    bx, by = int(x) - x0, int(y) - y0
    region = canvas[by : by + max(int(h), 1), bx : bx + max(int(w), 1)]
    return float(np.count_nonzero(region)) / max(region.size, 1)


def _contains(outer: tuple[float, float, float, float], inner: tuple[float, float, float, float]) -> float:
    """Fracción de `inner` que cae dentro de `outer`."""
    ox, oy, ow, oh = outer
    ix, iy, iw, ih = inner
    x = max(0.0, min(ox + ow, ix + iw) - max(ox, ix))
    y = max(0.0, min(oy + oh, iy + ih) - max(oy, iy))
    return (x * y) / (iw * ih) if iw and ih else 0.0


#: Cuánto dura la entrada de la cámara antes de que aparezca el primer diálogo.
ENTER_MS = 450
#: Duración de la aparición de un globo.
REVEAL_MS = 260
#: Piso y techo del tiempo de lectura de un globo.
READ_MS = (650, 2800)
#: Escala que convierte tinta relativa a la página en milisegundos de lectura.
READ_SCALE = 240_000
#: Pausa final, para no cortar encima de la última palabra.
TAIL_MS = 600


def read_ms(ink_ratio: float) -> int:
    """Tiempo de lectura estimado a partir de cuánta tinta tiene el globo.

    La cantidad de tinta es proporcional a la cantidad de letras, y relativizarla al tamaño
    de la página la vuelve independiente de la resolución del escaneo.
    """
    lo, hi = READ_MS
    return int(min(max(lo + ink_ratio * READ_SCALE, lo), hi))


def _beats(balloons: list[dict]) -> list[dict]:
    """Timeline de la viñeta: entra la cámara y el diálogo aparece en orden de lectura."""
    beats: list[dict] = [
        {"t": 0, "ms": ENTER_MS, "cam": {"kind": "punchIn", "from": 1.06, "to": 1.0}}
    ]

    t = ENTER_MS
    for balloon in balloons:
        beats.append({"t": t, "ms": REVEAL_MS, "reveal": balloon["id"]})
        t += REVEAL_MS + read_ms(balloon["inkArea"])

    beats.append({"t": t, "ms": 0, "hold": TAIL_MS})
    return beats


def analyse_page(
    page: Page,
    detector: Detector,
    page_id: str,
    *,
    rtl: bool = True,
    lift_text: bool = True,
) -> tuple[dict, BuildStats, np.ndarray, dict[str, bytes]]:
    """Analiza una página y, si `lift_text`, saca el diálogo del arte.

    Devuelve el manifest de la página, las estadísticas, la imagen (ya sin el texto que se
    haya levantado) y los sprites listos para empaquetar.
    """
    stats = BuildStats(pages=1)
    sprites: dict[str, bytes] = {}

    image = cv2.imdecode(np.frombuffer(page.data, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"No se pudo decodificar {page.name}")
    h, w = image.shape[:2]
    page_area = float(w * h)

    t0 = time.perf_counter()
    dets = detector(image)
    stats.ms = (time.perf_counter() - t0) * 1000

    big_enough = [d for d in dets if d.cls == "frame" and d.area / page_area >= MIN_PANEL_AREA_RATIO]
    raw_balloons = [d for d in dets if d.cls == "balloon"]

    panels = _dedupe(big_enough)
    balloons = _dedupe(raw_balloons)
    texts = [d for d in dets if d.cls == "text"]

    stats.dropped = sum(1 for d in dets if d.cls == "frame") - len(big_enough)
    stats.duplicates = (len(big_enough) - len(panels)) + (len(raw_balloons) - len(balloons))

    # Una splash sin marco dibujado no produce detecciones: la página entera es la viñeta.
    if not panels:
        stats.splashes = 1
        panels = [
            Detection(
                cls="frame",
                conf=1.0,
                bbox=(0.0, 0.0, float(w), float(h)),
                polygon=[(0, 0), (w, 0), (w, h), (0, h)],
            )
        ]

    # Con las siluetas, y no solo las cajas, se detectan los gutters diagonales.
    order = reading_order(
        [Box(*p.bbox) for p in panels],
        rtl=rtl,
        tol=default_tolerance(w, h),
        polygons=[p.polygon for p in panels],
    )

    # 1. Levantar todo el texto seguro de la página, antes de repartirlo.
    #
    #    Hacerlo dentro del bucle de viñetas dejaba sin levantar el diálogo de los globos
    #    que quedan a caballo de un borde diagonal: no alcanzan el umbral de pertenencia en
    #    ninguna viñeta, quedan huérfanos y su texto se quedaba pintado en el arte.
    lifted: list[tuple[Detection, Sprite]] = []
    if lift_text:
        for text in texts:
            sprite = dialogue.extract(image, text.polygon)
            if sprite:
                lifted.append((text, sprite))

    # 2. Agrupar los bloques por globo: el modelo parte un diálogo largo en varios trozos,
    #    y para el lector es uno solo.
    taken: set[int] = set()
    groups: list[tuple[tuple[float, float, float, float], list[Sprite]]] = []
    for balloon in balloons:
        mine = [
            (i, s)
            for i, (t, s) in enumerate(lifted)
            if i not in taken and _contains(balloon.bbox, t.bbox) >= 0.5
        ]
        if mine:
            taken.update(i for i, _ in mine)
            groups.append((balloon.bbox, [s for _, s in mine]))
    for i, (text, sprite) in enumerate(lifted):
        if i not in taken:
            groups.append((text.bbox, [sprite]))

    # Globos detectados sin texto levantado: entran igual, para no perder la cuenta.
    for balloon in balloons:
        if not any(_contains(balloon.bbox, g[0]) > 0.5 for g in groups):
            groups.append((balloon.bbox, []))

    # 3. Cada grupo va a la viñeta con la que más se solapa. Sin umbral: un globo siempre
    #    pertenece a alguna viñeta, aunque cruce un borde.
    per_panel: dict[int, list[tuple[tuple[float, float, float, float], list[Sprite]]]] = {}
    for group in groups:
        best, score = None, 0.0
        for pi, panel in enumerate(panels):
            overlap = _inside_polygon(panel.polygon, group[0])
            if overlap > score:
                best, score = pi, overlap
        if best is None:
            # Ningún polígono lo contiene: se cae a la caja para no perder el globo.
            best = max(
                range(len(panels)), key=lambda pi: _contains(panels[pi].bbox, group[0])
            )
        per_panel.setdefault(best, []).append(group)

    out_panels = []
    for position, idx in enumerate(order):
        panel = panels[idx]
        mine = per_panel.get(idx, [])

        # Dentro de la viñeta, el diálogo también se lee de derecha a izquierda.
        inner = reading_order(
            [Box(*bbox) for bbox, _ in mine], rtl=rtl, tol=default_tolerance(w, h)
        )

        out_balloons = []
        for bpos, bidx in enumerate(inner):
            bbox, parts = mine[bidx]
            balloon_id = f"{page_id}.k{position}.b{bpos}"

            sprite_name = ""
            ink = 0.0
            if parts:
                merged = _merge_sprites(parts)
                sprite_name = f"sprites/{balloon_id}.png"
                sprites[sprite_name] = dialogue.encode(merged)
                bbox = (
                    float(merged.bbox[0]),
                    float(merged.bbox[1]),
                    float(merged.bbox[2]),
                    float(merged.bbox[3]),
                )
                ink = merged.ink * (merged.bbox[2] * merged.bbox[3]) / page_area
                stats.lifted += 1

            out_balloons.append(
                {
                    "id": balloon_id,
                    "order": bpos,
                    "mode": "text-only",
                    "sprite": sprite_name,
                    "bbox": [round(v, 1) for v in bbox],
                    "inkArea": round(ink, 6),
                    "reveal": "fade",
                }
            )

        stats.balloons += len(out_balloons)
        out_panels.append(
            {
                "id": f"{page_id}.k{position}",
                "order": position,
                "polygon": [[int(x), int(y)] for x, y in panel.polygon],
                "bbox": [round(v, 1) for v in panel.bbox],
                "confidence": round(panel.conf, 3),
                "balloons": out_balloons,
                "beats": _beats([b for b in out_balloons if b["sprite"]]),
            }
        )

    stats.panels = len(out_panels)
    stats.texts = len(texts)

    return (
        {"id": page_id, "image": "", "size": [w, h], "panels": out_panels},
        stats,
        image,
        sprites,
    )


def build(
    source: Path,
    out: Path,
    model: Path,
    *,
    rtl: bool = True,
    conf: float = 0.25,
    limit: int = 0,
    title: str | None = None,
    lift_text: bool = True,
    quality: int = 88,
    text_model: Path | None = None,
    progress=None,
) -> BuildStats:
    detector = Detector(model, conf=conf, text_model=text_model)
    total = BuildStats()
    pages_meta = []

    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as zf:
        for index, page in enumerate(read_pages(source)):
            if limit and index >= limit:
                break

            page_id = f"p{index + 1:03d}"
            meta, stats, image, sprites = analyse_page(
                page, detector, page_id, rtl=rtl, lift_text=lift_text
            )

            if sprites:
                # El arte cambió al levantar el texto, así que hay que recodificarlo.
                entry = f"pages/{page_id}.webp"
                ok, buf = cv2.imencode(".webp", image, [cv2.IMWRITE_WEBP_QUALITY, quality])
                if not ok:
                    raise RuntimeError(f"No se pudo codificar {page_id}")
                zf.writestr(entry, buf.tobytes())
                for name, blob in sprites.items():
                    zf.writestr(name, blob)
            else:
                # Sin cambios en los píxeles, los bytes originales sirven tal cual y se
                # ahorra el recodificado, que es lo más caro del empaquetado.
                entry = f"pages/{page_id}{page.suffix}"
                zf.writestr(entry, page.data)

            meta["image"] = entry
            pages_meta.append(meta)

            total.pages += 1
            total.panels += stats.panels
            total.balloons += stats.balloons
            total.texts += stats.texts
            total.splashes += stats.splashes
            total.dropped += stats.dropped
            total.duplicates += stats.duplicates
            total.lifted += stats.lifted
            total.ms += stats.ms
            if progress:
                progress(index, page, stats)

        manifest = {
            "version": 1,
            "title": title or source.stem,
            "readingDirection": "rtl" if rtl else "ltr",
            "generator": "mangacut/0.1",
            "pages": pages_meta,
        }
        zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, separators=(",", ":")))

    return total

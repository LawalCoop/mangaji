"""Construcción del `.cbza`: detectar, ordenar y empaquetar."""

from __future__ import annotations

import json
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from .archive import Page, read_pages
from .detect import Detector, Detection
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


def _dedupe(dets: list[Detection], threshold: float = DEDUPE_IOU) -> list[Detection]:
    """Se queda con la detección más confiable de cada grupo solapado."""
    kept: list[Detection] = []
    for det in sorted(dets, key=lambda d: -d.conf):
        if all(_polygon_iou(det.polygon, k.polygon) < threshold for k in kept):
            kept.append(det)
    return kept


def _contains(outer: tuple[float, float, float, float], inner: tuple[float, float, float, float]) -> float:
    """Fracción de `inner` que cae dentro de `outer`."""
    ox, oy, ow, oh = outer
    ix, iy, iw, ih = inner
    x = max(0.0, min(ox + ow, ix + iw) - max(ox, ix))
    y = max(0.0, min(oy + oh, iy + ih) - max(oy, iy))
    return (x * y) / (iw * ih) if iw and ih else 0.0


def _beats(panel_index: int) -> list[dict]:
    """Dirección mínima de v2: un acercamiento suave y una pausa.

    Las reglas por forma e intensidad llegan en v5 (`mangacut direct`); acá solo se busca
    que la cámara no sea un corte plano.
    """
    return [
        {"t": 0, "ms": 450, "cam": {"kind": "punchIn", "from": 1.06, "to": 1.0}},
        {"t": 450, "ms": 0, "hold": 1400},
    ]


def analyse_page(
    page: Page, detector: Detector, page_id: str, *, rtl: bool = True
) -> tuple[dict, BuildStats]:
    stats = BuildStats(pages=1)

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

    used_balloons: set[int] = set()
    out_panels = []
    for position, idx in enumerate(order):
        panel = panels[idx]
        mine = []
        for bi, balloon in enumerate(balloons):
            if bi in used_balloons:
                continue
            if _contains(panel.bbox, balloon.bbox) >= BALLOON_IN_PANEL_RATIO:
                used_balloons.add(bi)
                mine.append(balloon)

        # Dentro de la viñeta, el diálogo también se lee de derecha a izquierda.
        inner = reading_order([Box(*b.bbox) for b in mine], rtl=rtl, tol=default_tolerance(w, h))

        out_balloons = []
        for bpos, bidx in enumerate(inner):
            balloon = mine[bidx]
            # El texto que cae dentro del globo es lo que v4 va a ocultar y revelar.
            has_text = any(_contains(balloon.bbox, t.bbox) >= 0.5 for t in texts)
            out_balloons.append(
                {
                    "id": f"{page_id}.k{position}.b{bpos}",
                    "order": bpos,
                    "mode": "text-only",
                    "sprite": "",  # v4
                    "bbox": [round(v, 1) for v in balloon.bbox],
                    "inkArea": 0.0,  # v4
                    "reveal": "typewriter",
                    "hasText": has_text,
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
                "beats": _beats(position),
            }
        )

    stats.panels = len(out_panels)
    stats.texts = len(texts)

    return (
        {"id": page_id, "image": "", "size": [w, h], "panels": out_panels},
        stats,
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
    progress=None,
) -> BuildStats:
    detector = Detector(model, conf=conf)
    total = BuildStats()
    pages_meta = []

    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as zf:
        for index, page in enumerate(read_pages(source)):
            if limit and index >= limit:
                break

            page_id = f"p{index + 1:03d}"
            entry = f"pages/{page_id}{page.suffix}"
            meta, stats = analyse_page(page, detector, page_id, rtl=rtl)
            meta["image"] = entry

            # Sin recomprimir: mientras el arte no se toque, los bytes originales sirven.
            zf.writestr(entry, page.data)
            pages_meta.append(meta)

            total.pages += 1
            total.panels += stats.panels
            total.balloons += stats.balloons
            total.texts += stats.texts
            total.splashes += stats.splashes
            total.dropped += stats.dropped
            total.duplicates += stats.duplicates
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

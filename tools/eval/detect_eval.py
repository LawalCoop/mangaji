#!/usr/bin/env python3
"""Evalúa un detector de viñetas/globos sobre páginas reales.

Responde las tres preguntas del timebox de v2: ¿acierta?, ¿cuánto tarda en esta CPU?,
¿separa bien globo de texto? Genera overlays para inspección visual y un JSON con los
resultados crudos para poder comparar detectores entre sí.

    .mangacut/venv/bin/python tools/eval/detect_eval.py .mangacut/eval --out .mangacut/overlays

Usa Ultralytics (AGPL) solo como herramienta local de evaluación y exportación. El pipeline
definitivo corre el modelo exportado a ONNX con onnxruntime, sin esta dependencia.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from PIL import Image, ImageDraw

REPO = "ShadowB/Manga109-panel-balloon-text-yolov26-segmentation"

# 0: frame, 1: text, 2: balloon — según la model card.
COLORS = {
    "frame": (255, 64, 64),
    "text": (64, 200, 255),
    "balloon": (120, 255, 120),
}


def load_model(repo: str, weights: str | None):
    from huggingface_hub import list_repo_files, hf_hub_download
    from ultralytics import YOLO

    if weights:
        path = weights
    else:
        files = list_repo_files(repo)
        pts = [f for f in files if f.endswith(".pt")]
        if not pts:
            raise SystemExit(f"No hay pesos .pt en {repo}: {files}")
        # "best.pt" si está; si no, el primero.
        name = next((f for f in pts if f.endswith("best.pt")), pts[0])
        print(f"pesos: {name}  (de {len(files)} archivos en el repo)")
        path = hf_hub_download(repo, name)

    return YOLO(path)


def simplify(poly: list[list[float]], eps_px: float = 2.0) -> list[list[float]]:
    """Douglas-Peucker con épsilon **fijo en píxeles**.

    Un épsilon proporcional al perímetro parece más elegante pero es al revés: los contornos
    de máscara serpentean, su perímetro es enorme, y el umbral termina siendo gigante justo
    en los polígonos que más cuidado necesitan — cortando entrantes reales.

    Medido sobre 94 viñetas: 202 vértices de mediana → 22, con IoU 0.991 en el peor caso.
    """
    import cv2
    import numpy as np

    pts = np.array(poly, dtype=np.int32).reshape(-1, 1, 2)
    out = cv2.approxPolyDP(pts, eps_px, True).reshape(-1, 2)
    return out.tolist() if len(out) >= 3 else poly


def draw_overlay(img: Image.Image, dets: list[dict], out: Path, bbox: bool = False) -> None:
    """Dibuja la silueta detectada. La bbox queda apagada por defecto: superpuesta al
    polígono hace parecer rectangular todo lo que en realidad no lo es."""
    canvas = img.convert("RGB")
    layer = ImageDraw.Draw(canvas, "RGBA")

    for i, d in enumerate(dets):
        color = COLORS.get(d["cls"], (255, 255, 0))
        poly = d.get("polygon")
        if poly and len(poly) >= 3:
            pts = [tuple(p) for p in poly]
            layer.polygon(pts, fill=(*color, 30))
            layer.line([*pts, pts[0]], fill=(*color, 255), width=4)
        x, y, w, h = d["bbox"]
        if bbox or not poly:
            layer.rectangle([x, y, x + w, y + h], outline=(*color, 140), width=2)
        layer.text((x + 6, y + 4), f"{i}:{d['cls']} {d['conf']:.2f}", fill=(*color, 255))

    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out, "JPEG", quality=82)


GALLERY_CSS = """
:root { color-scheme: dark; }
body { margin:0; background:#0b0b0c; color:#d4d4d8;
  font:14px/1.5 ui-sans-serif,system-ui,sans-serif; }
header { position:sticky; top:0; z-index:5; display:flex; gap:1.5rem; align-items:baseline;
  flex-wrap:wrap; padding:1rem 1.5rem; background:#0b0b0cee; backdrop-filter:blur(8px);
  border-bottom:1px solid #27272a; }
h1 { margin:0; font-size:1rem; font-weight:600; letter-spacing:-.01em; }
.legend { display:flex; gap:1rem; font-size:.8rem; color:#a1a1aa; }
.legend b { font-weight:500; }
.dot { display:inline-block; width:.6rem; height:.6rem; border-radius:2px; margin-right:.35rem; }
.hint { margin-left:auto; font-size:.8rem; color:#71717a; }
.grid { display:grid; gap:1rem; padding:1.5rem;
  grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); }
figure { margin:0; background:#141416; border:1px solid #27272a; border-radius:8px;
  overflow:hidden; }
.shot { position:relative; display:block; aspect-ratio:2/3; background:#000; }
.shot img { position:absolute; inset:0; width:100%; height:100%; object-fit:contain; }
.shot .raw { opacity:0; transition:opacity .12s; }
.shot:hover .raw { opacity:1; }
figcaption { display:flex; justify-content:space-between; gap:.5rem; padding:.6rem .75rem;
  font-size:.78rem; color:#a1a1aa; border-top:1px solid #27272a; }
figcaption .counts { color:#71717a; font-variant-numeric:tabular-nums; }
"""


def write_gallery(out: Path, report: list[dict], pages_dir: Path) -> Path:
    """Galería local para revisar las 19 páginas de un vistazo. Hover = página original."""
    import html
    import os

    rel = os.path.relpath(pages_dir, out)
    cards = []
    for r in report:
        stem = Path(r["page"]).stem
        counts = r["counts"]
        cards.append(
            f'<figure><a class="shot" href="{html.escape(stem)}.jpg" target="_blank">'
            f'<img src="{html.escape(stem)}.jpg" loading="lazy" alt="">'
            f'<img class="raw" src="{html.escape(rel)}/{html.escape(r["page"])}" loading="lazy" alt="">'
            f"</a><figcaption><span>{html.escape(r['page'][-14:])}</span>"
            f'<span class="counts">{counts["frame"]}v · {counts["balloon"]}g · '
            f'{counts["text"]}t · {r["ms"]:.0f}ms</span></figcaption></figure>'
        )

    dots = "".join(
        f'<b><span class="dot" style="background:rgb{c}"></span>{n}</b>'
        for n, c in (("viñeta", COLORS["frame"]), ("globo", COLORS["balloon"]), ("texto", COLORS["text"]))
    )
    total = {c: sum(r["counts"][c] for r in report) for c in COLORS}
    avg = sum(r["ms"] for r in report) / len(report)

    doc = f"""<!doctype html><meta charset="utf-8"><title>Detección — {len(report)} páginas</title>
<style>{GALLERY_CSS}</style>
<header><h1>Detección de viñetas</h1>
<div class="legend">{dots}</div>
<div class="legend"><b>{total["frame"]} viñetas · {total["balloon"]} globos · {total["text"]} textos</b>
<b>{avg:.0f} ms/página</b></div>
<div class="hint">pasá el mouse sobre una página para ver el original</div></header>
<div class="grid">{"".join(cards)}</div>"""

    index = out / "index.html"
    index.write_text(doc, encoding="utf-8")
    return index


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("pages", type=Path, help="directorio con las páginas")
    ap.add_argument("--out", type=Path, default=Path(".mangacut/overlays"))
    ap.add_argument("--repo", default=REPO)
    ap.add_argument("--weights", default=None, help="ruta a un .pt local")
    ap.add_argument("--imgsz", type=int, default=1280, help="el modelo se entrenó a 1280")
    ap.add_argument("--conf", type=float, default=0.25)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--bbox", action="store_true", help="dibujar también la caja envolvente")
    ap.add_argument("--eps", type=float, default=2.0, help="épsilon de simplificación, en px")
    ap.add_argument("--raw", action="store_true", help="polígonos sin simplificar")
    ap.add_argument(
        "--redraw",
        action="store_true",
        help="rehace los overlays desde report.json, sin volver a inferir",
    )
    args = ap.parse_args()

    if args.redraw:
        report = json.loads((args.out / "report.json").read_text())
        for r in report:
            img = Image.open(args.pages / r["page"])
            dets = r["dets"]
            if not args.raw:
                dets = [
                    {**d, "polygon": simplify(d["polygon"], args.eps) if d["polygon"] else None}
                    for d in dets
                ]
            draw_overlay(img, dets, args.out / f"{Path(r['page']).stem}.jpg", bbox=args.bbox)
        index = write_gallery(args.out, report, args.pages)
        print(f"{len(report)} overlays rehechos — abrí {index}")
        return

    files = sorted(p for p in args.pages.iterdir() if p.suffix.lower() in {".png", ".jpg", ".jpeg"})
    if args.limit:
        files = files[: args.limit]
    if not files:
        raise SystemExit(f"Sin páginas en {args.pages}")

    model = load_model(args.repo, args.weights)
    names = model.names
    print(f"clases del modelo: {names}")

    report = []
    timings = []

    for path in files:
        img = Image.open(path)
        t0 = time.perf_counter()
        result = model.predict(img, imgsz=args.imgsz, conf=args.conf, verbose=False)[0]
        elapsed = (time.perf_counter() - t0) * 1000
        timings.append(elapsed)

        dets = []
        boxes = result.boxes
        polys = result.masks.xy if result.masks is not None else [None] * len(boxes)

        for box, poly in zip(boxes, polys):
            x1, y1, x2, y2 = (float(v) for v in box.xyxy[0])
            dets.append(
                {
                    "cls": names[int(box.cls)],
                    "conf": float(box.conf),
                    "bbox": [x1, y1, x2 - x1, y2 - y1],
                    "polygon": [[float(a), float(b)] for a, b in poly] if poly is not None else None,
                }
            )

        counts = {c: sum(1 for d in dets if d["cls"] == c) for c in COLORS}
        report.append({"page": path.name, "ms": round(elapsed, 1), "counts": counts, "dets": dets})
        print(f"{path.name:34s} {elapsed:7.0f} ms  {counts}")

        draw_overlay(img, dets, args.out / f"{path.stem}.jpg", bbox=args.bbox)

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "report.json").write_text(json.dumps(report, indent=1))
    write_gallery(args.out, report, args.pages)

    total = {c: sum(r["counts"][c] for r in report) for c in COLORS}
    avg = sum(timings) / len(timings)
    print(f"\n{len(files)} páginas — {avg:.0f} ms/página (mediana {sorted(timings)[len(timings)//2]:.0f})")
    print(f"totales: {total}")
    print(f"proyección tomo de 200 páginas: {avg * 200 / 1000 / 60:.1f} min (1 proceso)")
    print(f"overlays en {args.out}")


if __name__ == "__main__":
    main()

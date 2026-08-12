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


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("pages", type=Path, help="directorio con las páginas")
    ap.add_argument("--out", type=Path, default=Path(".mangacut/overlays"))
    ap.add_argument("--repo", default=REPO)
    ap.add_argument("--weights", default=None, help="ruta a un .pt local")
    ap.add_argument("--imgsz", type=int, default=1280, help="el modelo se entrenó a 1280")
    ap.add_argument("--conf", type=float, default=0.25)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

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

        draw_overlay(img, dets, args.out / f"{path.stem}.jpg")

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "report.json").write_text(json.dumps(report, indent=1))

    total = {c: sum(r["counts"][c] for r in report) for c in COLORS}
    avg = sum(timings) / len(timings)
    print(f"\n{len(files)} páginas — {avg:.0f} ms/página (mediana {sorted(timings)[len(timings)//2]:.0f})")
    print(f"totales: {total}")
    print(f"proyección tomo de 200 páginas: {avg * 200 / 1000 / 60:.1f} min (1 proceso)")
    print(f"overlays en {args.out}")


if __name__ == "__main__":
    main()

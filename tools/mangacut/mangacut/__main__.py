"""CLI de mangacut.

    mangacut build tomo.cbr -o tomo.cbza
    mangacut export-onnx
    mangacut debug tomo.cbr --out overlays/
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

DEFAULT_MODEL = Path(".mangacut/models/panel-seg-1280.onnx")
#: Detector dedicado al diálogo. El de segmentación es mejor para viñetas —da máscaras—
#: pero con texto de scanlations en español se queda muy corto.
DEFAULT_TEXT_MODEL = Path(".mangacut/models/alt-panel-1280.onnx")
HF_REPO = "ShadowB/Manga109-panel-balloon-text-yolov26-segmentation"
TEXT_HF_REPO = "leoxs22/manga-panel-detector-yolo26n"


def cmd_build(args: argparse.Namespace) -> int:
    from .build import build

    if not args.model.exists():
        print(f"Falta el modelo en {args.model}. Corré: mangacut export-onnx", file=sys.stderr)
        return 2

    out = args.out or args.source.with_suffix(".cbza")

    def progress(index, page, stats):
        print(
            f"  {index + 1:3d}  {Path(page.name).name[-28:]:30s} "
            f"{stats.panels:2d} viñetas  {stats.balloons:2d} globos  {stats.ms:5.0f} ms"
            + ("  [splash]" if stats.splashes else "")
        )

    print(f"{args.source.name} → {out.name}")
    total = build(
        args.source,
        out,
        args.model,
        rtl=not args.ltr,
        conf=args.conf,
        limit=args.limit,
        title=args.title,
        lift_text=not args.keep_text,
        quality=args.quality,
        text_model=args.text_model if args.text_model and args.text_model.exists() else None,
        progress=progress if not args.quiet else None,
    )

    size_mb = out.stat().st_size / 1e6
    print(
        f"\n{total.pages} páginas · {total.panels} viñetas · {total.balloons} globos"
        f" · {total.splashes} splash"
    )
    if total.lifted:
        print(f"diálogo levantado del arte en {total.lifted} globos")
    if total.duplicates or total.dropped:
        print(f"descartados: {total.duplicates} duplicados, {total.dropped} bajo el área mínima")
    print(
        f"{total.ms / max(total.pages, 1):.0f} ms/página · "
        f"{total.ms / 1000:.1f} s en total · {size_mb:.1f} MB"
    )
    return 0


def cmd_export_onnx(args: argparse.Namespace) -> int:
    """Exporta los pesos a ONNX. Único paso que necesita Ultralytics (AGPL) y torch;
    el pipeline después corre solo con onnxruntime."""
    try:
        from huggingface_hub import hf_hub_download
        from ultralytics import YOLO
    except ImportError:
        print(
            "Necesita ultralytics y huggingface-hub, que solo hacen falta para exportar:\n"
            "  uv pip install ultralytics huggingface-hub",
            file=sys.stderr,
        )
        return 2

    weights = args.weights or hf_hub_download(args.repo, "best.pt")
    print(f"pesos: {weights}")
    produced = YOLO(weights).export(format="onnx", imgsz=args.imgsz, opset=17, simplify=False)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(produced, args.out)
    print(f"onnx: {args.out} ({args.out.stat().st_size / 1e6:.1f} MB)")
    return 0


def cmd_debug(args: argparse.Namespace) -> int:
    """Renderiza overlays de las detecciones para inspección visual."""
    import cv2
    import numpy as np

    from .archive import read_pages
    from .build import MIN_PANEL_AREA_RATIO, analyse_page
    from .detect import Detector

    detector = Detector(args.model, conf=args.conf)
    args.out.mkdir(parents=True, exist_ok=True)
    colors = {"frame": (64, 64, 255), "balloon": (120, 255, 120), "text": (255, 200, 64)}

    for index, page in enumerate(read_pages(args.source)):
        if args.limit and index >= args.limit:
            break
        image = cv2.imdecode(np.frombuffer(page.data, np.uint8), cv2.IMREAD_COLOR)
        meta, _, _, _ = analyse_page(
            page, detector, f"p{index + 1:03d}", rtl=not args.ltr, lift_text=False
        )

        for panel in meta["panels"]:
            pts = np.array(panel["polygon"], np.int32)
            cv2.polylines(image, [pts], True, colors["frame"], 3)
            x, y = pts[:, 0].min(), pts[:, 1].min()
            # El número es el orden de lectura: es lo que hay que auditar de un vistazo.
            cv2.putText(
                image, str(panel["order"] + 1), (int(x) + 10, int(y) + 46),
                cv2.FONT_HERSHEY_SIMPLEX, 1.6, colors["frame"], 4,
            )
            for balloon in panel["balloons"]:
                bx, by, bw, bh = (int(v) for v in balloon["bbox"])
                cv2.rectangle(image, (bx, by), (bx + bw, by + bh), colors["balloon"], 2)

        cv2.imwrite(str(args.out / f"p{index + 1:03d}.jpg"), image, [cv2.IMWRITE_JPEG_QUALITY, 82])
        print(f"  {index + 1:3d}  {len(meta['panels'])} viñetas")

    print(f"overlays en {args.out}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="mangacut", description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("source", type=Path, help="archivo CBZ o CBR")
    common.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    common.add_argument(
        "--text-model",
        type=Path,
        default=DEFAULT_TEXT_MODEL,
        help="detector dedicado al diálogo (vacío para usar solo el de segmentación)",
    )
    common.add_argument("--conf", type=float, default=0.25)
    common.add_argument("--limit", type=int, default=0, help="procesar solo N páginas")
    common.add_argument("--ltr", action="store_true", help="cómic occidental")

    p = sub.add_parser("build", parents=[common], help="genera el .cbza")
    p.add_argument("-o", "--out", type=Path, default=None)
    p.add_argument("--title", default=None)
    p.add_argument("--quiet", action="store_true")
    p.add_argument("--quality", type=int, default=88, help="calidad WebP de las páginas")
    p.add_argument(
        "--keep-text",
        action="store_true",
        help="deja el diálogo en el arte, sin levantarlo como sprite",
    )
    p.set_defaults(func=cmd_build)

    p = sub.add_parser("debug", parents=[common], help="overlays para inspección")
    p.add_argument("--out", type=Path, default=Path(".mangacut/debug"))
    p.set_defaults(func=cmd_debug)

    p = sub.add_parser("export-onnx", help="convierte los pesos a ONNX (una sola vez)")
    p.add_argument("--repo", default=HF_REPO)
    p.add_argument("--weights", default=None, help="ruta a un .pt local")
    p.add_argument("--imgsz", type=int, default=1280)
    p.add_argument("--out", type=Path, default=DEFAULT_MODEL)
    p.set_defaults(func=cmd_export_onnx)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())

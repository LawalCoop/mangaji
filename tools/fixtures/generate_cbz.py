#!/usr/bin/env python3
"""Genera CBZ sintéticos para probar el reader sin usar manga real.

Las páginas llevan su número en grande y los nombres de entrada están elegidos para
romper el orden lexicográfico (1, 2, ..., 10, 11), que es el error clásico al listar un CBZ.

    uv run --with pillow tools/fixtures/generate_cbz.py samples/test.cbz --pages 12
"""

from __future__ import annotations

import argparse
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# Tamaños distintos a propósito: el reader tiene que reencuadrar por página, no asumir uno.
SIZES = [(1600, 2300), (1600, 2300), (1240, 1754), (2400, 1700)]


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
    ):
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def make_page(number: int, total: int, size: tuple[int, int]) -> Image.Image:
    w, h = size
    img = Image.new("L", size, 255)
    d = ImageDraw.Draw(img)

    # Marco, para ver de un vistazo si el encuadre recorta algo que no debería.
    d.rectangle([8, 8, w - 8, h - 8], outline=0, width=6)

    label = str(number)
    f = font(int(h * 0.35))
    box = d.textbbox((0, 0), label, font=f)
    d.text(
        ((w - (box[2] - box[0])) / 2 - box[0], (h - (box[3] - box[1])) / 2 - box[1]),
        label,
        font=f,
        fill=0,
    )

    small = font(int(h * 0.03))
    d.text((40, 40), f"{w}x{h}", font=small, fill=0)
    d.text((40, h - 80), f"pagina {number} de {total}", font=small, fill=0)
    return img


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("out", type=Path)
    ap.add_argument("--pages", type=int, default=12)
    args = ap.parse_args()

    args.out.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(args.out, "w", zipfile.ZIP_DEFLATED) as z:
        # Ruido que traen los CBZ reales y que el reader debe descartar.
        z.writestr("ComicInfo.xml", "<ComicInfo><Title>fixture</Title></ComicInfo>")
        z.writestr("__MACOSX/._1.jpg", "basura")

        for i in range(1, args.pages + 1):
            img = make_page(i, args.pages, SIZES[(i - 1) % len(SIZES)])
            tmp = args.out.parent / f".page{i}.jpg"
            img.save(tmp, "JPEG", quality=80)
            # Sin ceros a la izquierda: así "10.jpg" cae antes que "2.jpg" al ordenar como texto.
            z.write(tmp, f"{i}.jpg")
            tmp.unlink()

    size_mb = args.out.stat().st_size / 1e6
    print(f"{args.out} — {args.pages} páginas, {size_mb:.1f} MB")


if __name__ == "__main__":
    main()

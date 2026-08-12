"""Lectura de CBZ y CBR.

El reader solo abre ZIP; los tomos suelen venir en RAR. La conversión vive acá, en el
pipeline, para que el reader no tenga que soportar RAR nunca: entra un CBR, sale un `.cbza`
que es ZIP.
"""

from __future__ import annotations

import re
import subprocess
import tempfile
import zipfile
from pathlib import Path
from typing import Iterator, NamedTuple

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".bmp"}


class Page(NamedTuple):
    name: str
    data: bytes

    @property
    def suffix(self) -> str:
        return Path(self.name).suffix.lower()


def is_junk(name: str) -> bool:
    base = Path(name).name
    return (
        name.startswith("__MACOSX/")
        or base.startswith("._")
        or base in {".DS_Store", "Thumbs.db"}
    )


def is_page(name: str) -> bool:
    return (
        not name.endswith("/")
        and Path(name).suffix.lower() in IMAGE_SUFFIXES
        and not is_junk(name)
    )


def natural_key(name: str) -> list:
    """"10.jpg" va después de "9.jpg". Ordenar como texto desordena el capítulo entero."""
    return [int(p) if p.isdigit() else p.lower() for p in re.split(r"(\d+)", name)]


def read_pages(path: Path) -> Iterator[Page]:
    """Páginas en orden de lectura, con sus bytes originales.

    Se devuelven sin recomprimir: mientras el arte no se modifique, el `.cbza` puede
    reutilizar los bytes tal cual y ahorrarse el reencode, que es lo más caro del pipeline.
    """
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as zf:
            names = sorted((n for n in zf.namelist() if is_page(n)), key=natural_key)
            for name in names:
                yield Page(name, zf.read(name))
        return

    # CBR y cualquier otro formato que libarchive entienda.
    with tempfile.TemporaryDirectory(prefix="mangacut-") as tmp:
        proc = subprocess.run(
            ["bsdtar", "-xf", str(path), "-C", tmp],
            capture_output=True,
        )
        if proc.returncode != 0:
            raise RuntimeError(
                f"No se pudo leer {path.name}: {proc.stderr.decode(errors='replace')[:300]}"
            )
        root = Path(tmp)
        files = [p for p in root.rglob("*") if p.is_file() and is_page(str(p.relative_to(root)))]
        for file in sorted(files, key=lambda p: natural_key(str(p.relative_to(root)))):
            yield Page(str(file.relative_to(root)), file.read_bytes())


def count_pages(path: Path) -> int:
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as zf:
            return sum(1 for n in zf.namelist() if is_page(n))
    out = subprocess.run(["bsdtar", "-tf", str(path)], capture_output=True, text=True)
    return sum(1 for n in out.stdout.splitlines() if is_page(n))

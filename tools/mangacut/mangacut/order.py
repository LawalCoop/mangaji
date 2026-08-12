"""Orden de lectura de las viñetas de una página.

Ordenar por coordenada no funciona: en cuanto hay una fila partida en dos columnas, o una
viñeta alta al lado de dos bajas, cualquier `sort` por y o por x mezcla la lectura.

El algoritmo es un corte recursivo: buscar una franja libre que parta la página en bloques,
ordenar los bloques (arriba→abajo para cortes horizontales, derecha→izquierda para verticales,
que es el sentido del manga) y repetir dentro de cada bloque. Es lo que reproduce el orden
que un lector humano da por obvio.
"""

from __future__ import annotations

from typing import NamedTuple, Sequence


class Box(NamedTuple):
    x: float
    y: float
    w: float
    h: float

    @property
    def x2(self) -> float:
        return self.x + self.w

    @property
    def y2(self) -> float:
        return self.y + self.h


def _gaps(spans: Sequence[tuple[float, float]], tol: float) -> list[float]:
    """Puntos de corte: huecos entre intervalos, una vez fusionados los que se solapan."""
    if len(spans) < 2:
        return []
    ordered = sorted(spans)
    cuts: list[float] = []
    end = ordered[0][1]
    for start, stop in ordered[1:]:
        if start - end > tol:
            cuts.append((end + start) / 2)
            end = stop
        else:
            end = max(end, stop)
    return cuts


def _split(boxes: Sequence[Box], cut: float, axis: int) -> tuple[list[Box], list[Box]]:
    lo = [b for b in boxes if (b.y2 if axis else b.x2) <= cut]
    hi = [b for b in boxes if (b.y if axis else b.x) >= cut]
    return lo, hi


def reading_order(
    boxes: Sequence[Box], *, rtl: bool = True, tol: float = 0.0
) -> list[int]:
    """Devuelve los índices de `boxes` en orden de lectura.

    `rtl=True` para manga (derecha→izquierda). `tol` absorbe gutters imperfectos: dos viñetas
    separadas por menos que eso se consideran de la misma banda.
    """
    indexed = list(enumerate(boxes))

    def walk(items: list[tuple[int, Box]]) -> list[int]:
        if len(items) <= 1:
            return [i for i, _ in items]

        # Filas primero: es la partición que domina la lectura de una página.
        rows = _gaps([(b.y, b.y2) for _, b in items], tol)
        if rows:
            cut = rows[0]
            top = [it for it in items if it[1].y2 <= cut]
            bottom = [it for it in items if it[1].y >= cut]
            if top and bottom and len(top) + len(bottom) == len(items):
                return walk(top) + walk(bottom)

        # Después columnas, recorridas en el sentido de lectura.
        cols = _gaps([(b.x, b.x2) for _, b in items], tol)
        if cols:
            cut = cols[-1] if rtl else cols[0]
            left = [it for it in items if it[1].x2 <= cut]
            right = [it for it in items if it[1].x >= cut]
            if left and right and len(left) + len(right) == len(items):
                first, second = (right, left) if rtl else (left, right)
                return walk(first) + walk(second)

        # Bloque irreducible (viñetas solapadas o en diagonal): se cae al criterio simple.
        key = (lambda it: (it[1].y, -it[1].x)) if rtl else (lambda it: (it[1].y, it[1].x))
        return [i for i, _ in sorted(items, key=key)]

    return walk(indexed)


def default_tolerance(page_w: float, page_h: float) -> float:
    """Gutter mínimo que separa dos viñetas: ~1 % del lado menor de la página."""
    return 0.01 * min(page_w, page_h)

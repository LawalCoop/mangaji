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


#: Cuánto tienen que compartir dos viñetas en vertical para considerarse de la misma banda.
#: Por encima de esto manda la columna (derecha primero en manga) y no la altura.
SAME_BAND_RATIO = 0.5


def _same_band(a: Box, b: Box) -> bool:
    overlap = min(a.y2, b.y2) - max(a.y, b.y)
    return overlap > SAME_BAND_RATIO * min(a.h, b.h)


def _untangle(items: list[tuple[int, Box]], *, rtl: bool) -> list[int]:
    """Ordena un bloque que ningún corte recto puede separar.

    Con bordes diagonales dos viñetas de la misma fila se pisan en ambas proyecciones, y
    ordenar por `y` deja que una diferencia de pocos píxeles decida mal toda la fila. La
    regla que aplica un lector es distinta: si comparten banda vertical manda la columna
    —derecha primero en manga—, y solo si no la comparten manda la altura.

    Esas precedencias se resuelven con un orden topológico, que las respeta de a pares sin
    depender de que la comparación sea transitiva.
    """
    n = len(items)
    after: list[set[int]] = [set() for _ in range(n)]
    indegree = [0] * n

    for i in range(n):
        for j in range(i + 1, n):
            a, b = items[i][1], items[j][1]
            if _same_band(a, b):
                first, second = (i, j) if ((a.x2 > b.x2) == rtl) else (j, i)
            else:
                first, second = (i, j) if a.y <= b.y else (j, i)
            if second not in after[first]:
                after[first].add(second)
                indegree[second] += 1

    # Desempate estable: lo más cercano al origen de lectura (arriba y al margen inicial).
    def rank(k: int) -> tuple[float, float]:
        box = items[k][1]
        return (box.y, -box.x2 if rtl else box.x)

    ready = sorted((k for k in range(n) if indegree[k] == 0), key=rank)
    out: list[int] = []
    while ready:
        k = ready.pop(0)
        out.append(items[k][0])
        for nxt in sorted(after[k], key=rank):
            indegree[nxt] -= 1
            if indegree[nxt] == 0:
                ready.append(nxt)
        ready.sort(key=rank)

    if len(out) < n:  # ciclo: quedan nodos sin resolver, se agregan por cercanía al origen
        done = set(out)
        out.extend(items[k][0] for k in sorted(range(n), key=rank) if items[k][0] not in done)
    return out


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

        # Bloque irreducible: viñetas separadas por bordes diagonales, cuyas proyecciones
        # se pisan y no admiten ningún corte recto.
        return _untangle(items, rtl=rtl)

    return walk(indexed)


def default_tolerance(page_w: float, page_h: float) -> float:
    """Gutter mínimo que separa dos viñetas: ~1 % del lado menor de la página."""
    return 0.01 * min(page_w, page_h)

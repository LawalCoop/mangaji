"""Orden de lectura de las viñetas de una página.

Implementa el algoritmo de `manga109/panel-order-estimator` (Kovanen et al.), que es el
que usa el propio grupo del dataset Manga109. No conviene inventar acá: un lector humano
nunca duda del orden, así que el algoritmo correcto ya está descrito y probado.

Construcción del árbol, recursiva sobre el conjunto de viñetas:

1. Si existe un pivote **horizontal** que separe el conjunto en dos, separar y repetir.
2. Si no, probar con un pivote **vertical**.
3. Si ninguno separa, el conjunto es una hoja.

Interpretación: en las divisiones horizontales se visita primero la parte de arriba; en las
verticales, primero la derecha (manga) o la izquierda (occidental).

La clave está en qué se acepta como pivote: **no hace falta que la línea pase por un hueco
limpio**. Puede atravesar viñetas siempre que a ninguna le recorte demasiado — se mide el
área del lado menor sobre el área total, y debe quedar bajo un umbral. Esa tolerancia es lo
que permite separar filas con bordes diagonales, donde una línea recta siempre roza alguna
esquina y exigir un gutter perfecto no separaría nada.
"""

from __future__ import annotations

from typing import NamedTuple, Sequence

Point = tuple[float, float]
Polygon = Sequence[Point]

#: Fracción máxima de una viñeta que un pivote puede dejar del lado equivocado.
#: Con 0 haría falta un gutter perfecto y las páginas diagonales quedarían sin separar.
DEFAULT_THRESHOLD = 0.15


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

    def corners(self) -> list[Point]:
        return [(self.x, self.y), (self.x2, self.y), (self.x2, self.y2), (self.x, self.y2)]


def _area(poly: Polygon) -> float:
    """Área por la fórmula del cordón de zapato."""
    total = 0.0
    for i in range(len(poly)):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % len(poly)]
        total += x1 * y2 - x2 * y1
    return abs(total) / 2.0


def _clip(poly: Polygon, axis: int, pivot: float, keep_lower: bool) -> list[Point]:
    """Recorta el polígono al semiplano de un lado del pivote (Sutherland-Hodgman)."""
    out: list[Point] = []
    inside = lambda p: (p[axis] <= pivot) if keep_lower else (p[axis] >= pivot)

    for i in range(len(poly)):
        a = poly[i]
        b = poly[(i + 1) % len(poly)]
        a_in, b_in = inside(a), inside(b)
        if a_in:
            out.append(a)
        if a_in != b_in:
            span = b[axis] - a[axis]
            if span:
                t = (pivot - a[axis]) / span
                out.append((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])))
    return out


def _split(
    polys: Sequence[Polygon], axis: int, pivot: float, threshold: float
) -> tuple[list[int], list[int]] | None:
    """Reparte las viñetas a ambos lados del pivote, o None si alguna queda demasiado partida.

    Una viñeta que el pivote roza se asigna entera al lado donde tiene más área; lo que se
    exige es que la parte que queda del otro lado sea despreciable.
    """
    lower: list[int] = []
    upper: list[int] = []

    for i, poly in enumerate(polys):
        total = _area(poly)
        if total <= 0:
            continue
        below = _area(_clip(poly, axis, pivot, keep_lower=True))
        above = total - below
        if min(below, above) / total > threshold:
            return None
        (lower if below >= above else upper).append(i)

    if not lower or not upper:
        return None
    return lower, upper


def _pivots(polys: Sequence[Polygon], axis: int) -> list[float]:
    """Candidatos a pivote: los bordes de las viñetas, que es donde caen los gutters."""
    edges: set[float] = set()
    for poly in polys:
        values = [p[axis] for p in poly]
        edges.add(min(values))
        edges.add(max(values))
    return sorted(edges)


def reading_order(
    boxes: Sequence[Box],
    *,
    rtl: bool = True,
    tol: float = 0.0,  # aceptado por compatibilidad; el algoritmo usa `threshold`
    polygons: Sequence[Polygon] | None = None,
    threshold: float = DEFAULT_THRESHOLD,
) -> list[int]:
    """Índices de `boxes` en orden de lectura.

    `polygons` da la silueta real de cada viñeta. Sin ellos se usan las esquinas de la caja,
    que en viñetas diagonales exagera el área y hace más difícil separar.
    """
    shapes: list[Polygon] = list(polygons) if polygons else [b.corners() for b in boxes]

    def walk(idx: list[int]) -> list[int]:
        if len(idx) <= 1:
            return idx

        polys = [shapes[i] for i in idx]

        # Paso 1: pivote horizontal — la lectura se estructura en filas antes que en columnas.
        for pivot in _pivots(polys, axis=1):
            parts = _split(polys, axis=1, pivot=pivot, threshold=threshold)
            if parts:
                top, bottom = parts
                return walk([idx[i] for i in top]) + walk([idx[i] for i in bottom])

        # Paso 2: pivote vertical — dentro de la fila, primero la derecha en manga.
        for pivot in _pivots(polys, axis=0):
            parts = _split(polys, axis=0, pivot=pivot, threshold=threshold)
            if parts:
                left, right = parts
                first, second = (right, left) if rtl else (left, right)
                return walk([idx[i] for i in first]) + walk([idx[i] for i in second])

        # Paso 3: hoja inseparable. El estimador original les asigna un único orden; acá
        # hace falta uno total, y ordenar por altura no sirve: dos viñetas de la misma fila
        # que ningún pivote separó se leen por columna, y una diferencia de pocos píxeles
        # en el borde superior invertiría la fila entera.
        return _untangle(idx, shapes, rtl=rtl)

    return walk(list(range(len(boxes))))


#: Cuánto tienen que compartir dos viñetas en vertical para considerarse de la misma fila.
SAME_BAND_RATIO = 0.5


def _extent(poly: Polygon, axis: int) -> tuple[float, float]:
    values = [p[axis] for p in poly]
    return min(values), max(values)


def _untangle(idx: list[int], shapes: list[Polygon], *, rtl: bool) -> list[int]:
    """Ordena un grupo que ningún pivote pudo separar.

    Si dos viñetas comparten franja vertical, manda la columna —derecha primero en manga—;
    si no la comparten, manda la altura. Las precedencias se resuelven con un orden
    topológico, que las respeta de a pares sin exigir que la comparación sea transitiva.
    """
    n = len(idx)
    spans = [(_extent(shapes[i], 0), _extent(shapes[i], 1)) for i in idx]

    after: list[set[int]] = [set() for _ in range(n)]
    indegree = [0] * n
    for i in range(n):
        (ax0, ax1), (ay0, ay1) = spans[i]
        for j in range(i + 1, n):
            (bx0, bx1), (by0, by1) = spans[j]
            overlap = min(ay1, by1) - max(ay0, by0)
            same_row = overlap > SAME_BAND_RATIO * min(ay1 - ay0, by1 - by0)
            if same_row:
                first, second = (i, j) if ((ax1 > bx1) == rtl) else (j, i)
            else:
                first, second = (i, j) if ay0 <= by0 else (j, i)
            if second not in after[first]:
                after[first].add(second)
                indegree[second] += 1

    def rank(k: int) -> tuple[float, float]:
        (x0, x1), (y0, _) = spans[k]
        return (y0, -x1 if rtl else x0)

    ready = sorted((k for k in range(n) if indegree[k] == 0), key=rank)
    out: list[int] = []
    while ready:
        k = ready.pop(0)
        out.append(idx[k])
        for nxt in sorted(after[k], key=rank):
            indegree[nxt] -= 1
            if indegree[nxt] == 0:
                ready.append(nxt)
        ready.sort(key=rank)

    if len(out) < n:  # ciclo entre precedencias: se completa por cercanía al origen
        done = set(out)
        out.extend(idx[k] for k in sorted(range(n), key=rank) if idx[k] not in done)
    return out


def default_tolerance(page_w: float, page_h: float) -> float:
    """Se mantiene por compatibilidad con quien ya la llamaba; el algoritmo no la usa."""
    return 0.01 * min(page_w, page_h)

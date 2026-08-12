"""El orden de lectura se verifica contra layouts de orden conocido por construcción.

No hace falta manga real: lo que se prueba es la topología de la página, y esa se puede
escribir a mano. Cada caso lleva las viñetas ya en su orden correcto, y el test las mezcla
antes de ordenarlas para que el resultado no dependa de cómo venían.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mangacut.order import Box, reading_order  # noqa: E402

W, H = 1000.0, 1500.0
TOL = 10.0


def check(expected: list[Box], *, rtl: bool = True) -> None:
    """`expected` ya está en orden de lectura; se baraja y se comprueba que se reconstruye."""
    shuffled = list(reversed(expected))  # peor caso determinista: todo al revés
    got = reading_order(shuffled, rtl=rtl, tol=TOL)
    assert [shuffled[i] for i in got] == expected


def test_una_sola_vineta():
    assert reading_order([Box(0, 0, W, H)]) == [0]


def test_filas_apiladas():
    check([Box(0, 0, W, 480), Box(0, 500, W, 480), Box(0, 1000, W, 480)])


def test_rejilla_2x2_derecha_a_izquierda():
    # En manga la fila de arriba se lee de derecha a izquierda antes de bajar.
    check(
        [
            Box(510, 0, 480, 700),  # arriba-derecha
            Box(0, 0, 480, 700),  # arriba-izquierda
            Box(510, 720, 480, 700),  # abajo-derecha
            Box(0, 720, 480, 700),  # abajo-izquierda
        ]
    )


def test_rejilla_2x2_occidental():
    check(
        [
            Box(0, 0, 480, 700),
            Box(510, 0, 480, 700),
            Box(0, 720, 480, 700),
            Box(510, 720, 480, 700),
        ],
        rtl=False,
    )


def test_fila_partida_en_columnas():
    # Una banda ancha arriba, dos viñetas debajo, y otra banda ancha al final.
    check(
        [
            Box(0, 0, W, 400),
            Box(510, 420, 480, 500),
            Box(0, 420, 480, 500),
            Box(0, 940, W, 400),
        ]
    )


def test_columna_alta_junto_a_dos_bajas():
    """El caso que rompe cualquier sort por coordenada.

    La columna derecha es una sola viñeta alta; la izquierda son dos apiladas. Ordenar por
    `y` intercalaría la alta entre las dos bajas.
    """
    check(
        [
            Box(510, 0, 480, 1000),  # alta, a la derecha: se lee entera primero
            Box(0, 0, 480, 480),
            Box(0, 500, 480, 480),
        ]
    )


def test_escalonado_de_tres_bandas():
    check(
        [
            Box(0, 0, W, 300),
            Box(660, 320, 330, 400),
            Box(340, 320, 300, 400),
            Box(0, 320, 320, 400),
            Box(500, 740, 490, 600),
            Box(0, 740, 480, 600),
        ]
    )


def test_gutter_angosto_no_parte_la_banda():
    """Dos viñetas separadas por menos que la tolerancia son la misma banda."""
    boxes = [Box(510, 0, 480, 700), Box(0, 4, 480, 700)]  # 4 px de desalineación
    assert [boxes[i] for i in reading_order(boxes, tol=TOL)] == boxes


def test_solapadas_caen_al_criterio_simple():
    """Sin corte posible no hay respuesta canónica; lo importante es no romperse."""
    boxes = [Box(0, 0, 600, 600), Box(300, 300, 600, 600)]
    got = reading_order(boxes, tol=TOL)
    assert sorted(got) == [0, 1]


def test_borde_diagonal_no_invierte_la_fila():
    """El caso que fallaba en Kingdom.

    Dos viñetas de la misma fila separadas por un borde inclinado. Sus cajas se pisan en
    ambos ejes —por eso hay que pasar las siluetas—, pero el pivote vertical las separa:
    a cada trapecio le recorta una esquina despreciable.
    """
    izq = [(10.0, 520.0), (620.0, 520.0), (710.0, 990.0), (10.0, 990.0)]
    der = [(640.0, 528.0), (1000.0, 528.0), (1000.0, 988.0), (730.0, 988.0)]
    boxes = [Box(10, 520, 700, 470), Box(640, 528, 360, 460)]

    got = reading_order(boxes, polygons=[izq, der])
    assert got == [1, 0], "la de la derecha se lee primero"


def test_diagonal_con_banda_siguiente():
    """La fila diagonal se ordena bien y no contamina la banda de abajo."""
    izq = [(10.0, 0.0), (620.0, 0.0), (710.0, 470.0), (10.0, 470.0)]
    der = [(640.0, 8.0), (1000.0, 8.0), (1000.0, 468.0), (730.0, 468.0)]
    abajo = [(0.0, 500.0), (1000.0, 500.0), (1000.0, 900.0), (0.0, 900.0)]
    boxes = [Box(10, 0, 700, 470), Box(640, 8, 360, 460), Box(0, 500, W, 400)]

    got = reading_order(boxes, polygons=[izq, der, abajo])
    assert got == [1, 0, 2]


def test_alta_a_la_derecha_no_se_intercala():
    """Una viñeta alta a la derecha comparte banda con dos bajas: va primero, entera."""
    boxes = [
        Box(600, 0, 390, 980),  # alta, derecha
        Box(0, 10, 560, 470),  # baja, izquierda arriba
        Box(0, 500, 560, 480),  # baja, izquierda abajo
    ]
    got = reading_order(boxes, tol=TOL)
    assert got[0] == 0, "la alta de la derecha se lee antes que las dos de la izquierda"


@pytest.mark.parametrize("rtl", [True, False])
def test_es_una_permutacion(rtl: bool):
    boxes = [Box(x * 260, y * 380, 240, 360) for y in range(4) for x in range(4)]
    got = reading_order(boxes, rtl=rtl, tol=TOL)
    assert sorted(got) == list(range(16))


def tri(pts):
    """Polígono explícito, para layouts con gutters diagonales."""
    return [(float(x), float(y)) for x, y in pts]


def test_gutter_diagonal_separa_dos_viñetas():
    """El caso que antes no tenía corte posible.

    Dos viñetas de la misma fila con el borde inclinado: sus sombras horizontales y
    verticales se pisan, pero existe un gutter diagonal que las separa limpiamente.
    """
    derecha = tri([(520, 0), (1000, 0), (1000, 470), (600, 470)])
    izquierda = tri([(0, 0), (500, 0), (580, 470), (0, 470)])
    boxes = [Box(0, 0, 580, 470), Box(520, 0, 480, 470)]  # cajas que se solapan en x

    got = reading_order(boxes, tol=TOL, polygons=[izquierda, derecha])
    assert got == [1, 0], "la de la derecha se lee primero"


def test_banda_diagonal_completa():
    """Fila superior, banda diagonal de dos, y fila inferior."""
    arriba = tri([(0, 0), (1000, 0), (1000, 300), (0, 300)])
    der = tri([(520, 320), (1000, 320), (1000, 780), (600, 780)])
    izq = tri([(0, 320), (500, 320), (580, 780), (0, 780)])
    abajo = tri([(0, 800), (1000, 800), (1000, 1100), (0, 1100)])

    boxes = [
        Box(0, 0, 1000, 300),
        Box(0, 320, 580, 460),
        Box(520, 320, 480, 460),
        Box(0, 800, 1000, 300),
    ]
    got = reading_order(boxes, tol=TOL, polygons=[arriba, izq, der, abajo])
    assert got == [0, 2, 1, 3]

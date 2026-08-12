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


@pytest.mark.parametrize("rtl", [True, False])
def test_es_una_permutacion(rtl: bool):
    boxes = [Box(x * 260, y * 380, 240, 360) for y in range(4) for x in range(4)]
    got = reading_order(boxes, rtl=rtl, tol=TOL)
    assert sorted(got) == list(range(16))

"""Dirección de cada viñeta: qué hace la cámara, qué efecto lleva y cuánto dura.

Las reglas son deterministas y salen de medir la viñeta, no de elegir al azar: la forma
decide el movimiento —una viñeta ancha se recorre, una alta se baja—, y la intensidad
decide el efecto y el ritmo. Una página tranquila y una de batalla se leen distinto porque
se ven distinto, no porque se les haya puesto una etiqueta.

Regla de contención: **como mucho un efecto por viñeta**, y solo si la medición lo pide. El
valor por defecto es no tener ninguno; los efectos gratuitos son lo que hace que algo así
se vea barato.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass(slots=True)
class Look:
    """Lo que se puede medir de una viñeta mirando solo sus píxeles."""

    #: Fracción de tinta: qué tan cargada está.
    ink: float
    #: Qué tan alineadas están sus líneas largas — las de velocidad lo están mucho.
    streaks: float
    #: Ancho / alto.
    aspect: float
    #: Qué parte de la página ocupa.
    scale: float

    @property
    def is_splash(self) -> bool:
        return self.scale >= 0.55

    @property
    def is_wide(self) -> bool:
        return self.aspect >= 2.1

    @property
    def is_tall(self) -> bool:
        return self.aspect <= 0.62

    @property
    def is_action(self) -> bool:
        """Mucha tinta y líneas alineadas: impacto, velocidad, gritos."""
        return self.ink >= 0.34 and self.streaks >= 0.22

    @property
    def punch(self) -> float:
        """Cuánta violencia visual tiene la viñeta, de 0 a 1."""
        return min(1.0, self.ink * 1.15 + self.streaks * 0.75)


def measure(image: np.ndarray, polygon: list[tuple[int, int]], page_area: float) -> Look:
    """Mide una viñeta dentro de su página."""
    h, w = image.shape[:2]
    pts = np.array(polygon, np.int32)
    x, y, pw, ph = cv2.boundingRect(pts)
    pw, ph = max(pw, 1), max(ph, 1)

    mask = np.zeros((h, w), np.uint8)
    cv2.fillPoly(mask, [pts], 255)
    inside = mask[y : y + ph, x : x + pw]
    gray = cv2.cvtColor(image[y : y + ph, x : x + pw], cv2.COLOR_BGR2GRAY)

    pixels = gray[inside > 0]
    ink = float(np.count_nonzero(pixels < 110) / max(pixels.size, 1))

    return Look(
        ink=ink,
        streaks=_streaks(gray, inside),
        aspect=pw / ph,
        scale=float(pw * ph) / max(page_area, 1.0),
    )


def _streaks(gray: np.ndarray, inside: np.ndarray) -> float:
    """Cuánto predominan las líneas largas en una misma dirección.

    Las líneas de velocidad y las tramas de impacto son muchos trazos casi paralelos; el
    dibujo común no lo es. Se mide la concentración de las orientaciones, no su cantidad,
    para que una viñeta muy detallada no pase por una de acción.
    """
    edges = cv2.Canny(gray, 90, 200)
    edges[inside == 0] = 0
    side = max(min(gray.shape), 1)
    lines = cv2.HoughLinesP(
        edges,
        1,
        np.pi / 180,
        threshold=60,
        minLineLength=int(side * 0.28),
        maxLineGap=6,
    )
    if lines is None or len(lines) < 6:
        return 0.0

    # La forma que devuelve OpenCV varía entre versiones; aplanar evita depender de ella.
    segments = np.asarray(lines, dtype=np.float32).reshape(-1, 4)
    angles = np.arctan2(segments[:, 3] - segments[:, 1], segments[:, 2] - segments[:, 0])
    # Los ángulos son módulo 180°, así que se duplican antes de promediar como vectores.
    doubled = angles * 2.0
    concentration = float(
        np.hypot(np.mean(np.cos(doubled)), np.mean(np.sin(doubled)))
    )
    weight = min(len(segments) / 40.0, 1.0)
    return concentration * weight


def camera_for(look: Look) -> dict:
    """Movimiento de cámara según la forma de la viñeta.

    Una viñeta ancha pide recorrerla, una alta pide bajar por ella, una de acción pide
    entrar de golpe, y una página a sangre pide abrirse para que se vea entera.
    """
    if look.is_splash:
        return {"kind": "pullBack", "from": 1.18, "to": 1.0}
    if look.is_action:
        # El acercamiento brusco es la entrada clásica del anime a un plano de impacto:
        # va antes que la forma, porque manda la intensidad.
        return {"kind": "punchIn", "from": round(1.2 + 0.25 * look.punch, 2), "to": 1.0}
    if look.is_wide:
        return {"kind": "panH", "dir": "rtl"}
    if look.is_tall:
        return {"kind": "tiltV", "dir": "down"}
    return {"kind": "punchIn", "from": 1.06, "to": 1.0}


def fx_for(look: Look) -> dict | None:
    """A lo sumo un efecto, y solo si la viñeta lo pide.

    Uno solo, pero contundente: los efectos apilados y a media máquina son lo que hace que
    algo así se vea barato. Cuando entra, entra en serio.
    """
    # Las líneas van primero y el destello último. Medido sobre 94 viñetas del capítulo:
    # los trazos alineados son frecuentes (p80 = 0.62) y la tinta plena es rara (p95 = 0.52),
    # así que este orden reparte los tres efectos en vez de dejar que el destello —el más
    # invasivo— se quede con todas las viñetas de acción.
    if look.streaks >= 0.55:
        # La viñeta ya tiene líneas de velocidad dibujadas: el efecto las continúa hacia
        # afuera de la pantalla en vez de competir con ellas.
        return {
            "kind": "speedlines",
            "angle": 0.0,
            "density": round(0.45 + 0.5 * look.punch, 2),
        }
    if look.ink >= 0.52:
        # Casi toda tinta y sin dirección clara: golpe seco, sin líneas que continuar.
        return {"kind": "flash", "strength": round(0.55 + 0.35 * look.punch, 2)}
    if look.is_action:
        return {"kind": "shake", "amp": round(7 + 16 * look.punch, 1)}
    return None


def enter_ms(look: Look) -> int:
    """Cuánto tarda la cámara en asentarse sobre la viñeta."""
    if look.is_splash:
        return 900
    if look.is_action:
        return int(150 + 120 * (1 - look.punch))  # cuanto más golpe, más seco
    if look.is_wide or look.is_tall:
        return 700
    return 450


def hold_ms(look: Look) -> int:
    """Pausa de una viñeta sin diálogo: lo que tarda la vista en recorrerla."""
    base = 420 + 1400 * min(look.scale * 2.2, 1.0)
    if look.is_action:
        base *= 0.62  # la acción se lee de un vistazo y sigue
    return int(base)

"""Separación del diálogo: el texto sale del arte y queda como sprite aparte.

Un globo apoyado sobre arte denso no se puede quitar —debajo no hay dibujo, y ni el mejor
inpainting reconstruye un ejército—, pero el **interior del globo sí es plano**. Así que lo
que se oculta es el texto, no el globo: se recorta como sprite, y el hueco se rellena con el
mismo tono del papel que lo rodea. El resultado es exacto, sin inpainting, y funciona igual
en una página de fondo blanco que en una de batalla.

El globo vacío queda en la página, y el reader hace aparecer el texto encima cuando toca.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

#: Margen alrededor del texto que también se limpia, para no dejar restos de antialiasing.
DILATE_PX = 3
#: Ancho del anillo del que se toma el tono de relleno.
#:
#: Angosto a propósito: cuando el texto casi llena el globo, un anillo ancho se sale por
#: fuera del contorno y mide el arte de al lado, lo que hace rechazar globos perfectamente
#: seguros. Medido sobre 31 bloques de texto reales, con 3 px se levantan todos.
RING_PX = 3
#: Fracción mínima de papel para dar por sentado que hay un fondo detrás del texto.
#:
#: Es un piso bajo a propósito. La proporción de papel no distingue un globo de un dibujo:
#: un diálogo con letra gruesa llena de tinta su propio bloque y baja al 0.37 aunque esté
#: sobre un globo impecable. Lo que decide es `PAPER_LEVEL` sobre el percentil alto —si el
#: fondo *es* papel—, y esto solo descarta los bloques donde no queda fondo visible.
MIN_PAPER_RATIO = 0.22
#: A partir de qué nivel un píxel cuenta como papel.
PAPER_LEVEL = 195


@dataclass(slots=True)
class Sprite:
    """Texto recortado, listo para superponer sobre el globo vacío."""

    rgba: np.ndarray
    bbox: tuple[int, int, int, int]
    #: Proporción de píxeles con tinta: aproxima cuánto hay para leer.
    ink: float


def _ring(image: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Píxeles del anillo que rodea la región: dicen sobre qué está apoyado el texto."""
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (RING_PX * 2 + 1,) * 2)
    ring = cv2.dilate(mask, kernel) & ~mask
    return image[ring > 0].reshape(-1, image.shape[2])


def paper_ratio(pixels: np.ndarray) -> float:
    """Qué proporción de esos píxeles es papel."""
    if pixels.size == 0:
        return 0.0
    level = pixels.max(axis=1) if pixels.ndim > 1 else pixels
    return float(np.count_nonzero(level >= PAPER_LEVEL) / level.size)


def is_safe_to_lift(inside: np.ndarray) -> bool:
    """¿Se puede borrar el texto sin que se note?

    Solo si está apoyado sobre papel, y eso se ve **entre las letras**: un globo chico sobre
    fondo oscuro tiene el entorno negro aunque su interior sea blanco impecable, así que
    medir por fuera del bloque lo rechazaba.

    Lo que decide es **de qué tono es el fondo**, no cuánto fondo hay. Un diálogo con letra
    gruesa llena de tinta su propio bloque —baja al 0.37 de papel— y aun así está sobre un
    globo blanco: pedirle una proporción alta lo dejaba sin levantar. Sobre el dibujo, en
    cambio, ni siquiera la parte más clara llega a ser papel.
    """
    if inside.size == 0:
        return False
    level = inside.max(axis=1) if inside.ndim > 1 else inside
    background = float(np.percentile(level, 85))
    return background >= PAPER_LEVEL and paper_ratio(inside) >= MIN_PAPER_RATIO


def _fill_tone(pixels: np.ndarray) -> np.ndarray:
    """Tono del papel sobre el que se apoya el texto, para que el parche no se note.

    Se toma el percentil alto y no la mediana: entre los píxeles hay letras, y promediarlas
    daría un gris sucio. Tampoco blanco puro, porque los escaneos tienen su propio tono.
    """
    if pixels.size == 0:
        return np.array([255, 255, 255], np.uint8)
    return np.percentile(pixels, 85, axis=0).astype(np.uint8)


def extract(image: np.ndarray, polygon: list[tuple[int, int]]) -> Sprite | None:
    """Saca el texto de `polygon` del arte y devuelve su sprite.

    `image` se modifica en el lugar: donde estaba el texto queda el tono del papel.
    """
    h, w = image.shape[:2]
    pts = np.array(polygon, np.int32)
    x, y, bw, bh = cv2.boundingRect(pts)
    if bw <= 0 or bh <= 0:
        return None

    mask = np.zeros((h, w), np.uint8)
    cv2.fillPoly(mask, [pts], 255)
    if DILATE_PX:
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (DILATE_PX * 2 + 1,) * 2)
        mask = cv2.dilate(mask, kernel)

    inside = image[mask > 0].reshape(-1, image.shape[2])
    if not is_safe_to_lift(inside):
        return None  # apoyado sobre arte: borrarlo dejaría cicatriz

    x, y, bw, bh = cv2.boundingRect(mask)
    crop = image[y : y + bh, x : x + bw].copy()
    crop_mask = mask[y : y + bh, x : x + bw]

    # El alfa sale de la tinta: las letras quedan opacas y el papel transparente, así el
    # sprite se puede desvanecer encima del globo sin dibujar un rectángulo blanco.
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    paper = int(np.percentile(gray[crop_mask > 0], 90)) if (crop_mask > 0).any() else 255
    alpha = np.clip((paper.__int__() - gray.astype(np.int16)) * (255 / max(paper, 1)), 0, 255)
    alpha = (alpha * (crop_mask > 0)).astype(np.uint8)

    ink = float(np.count_nonzero(alpha > 40) / max(alpha.size, 1))
    if ink < 0.005:  # el modelo marcó texto donde no hay nada legible
        return None

    rgba = np.dstack([crop, alpha])
    image[mask > 0] = _fill_tone(inside)

    return Sprite(rgba=rgba, bbox=(x, y, bw, bh), ink=ink)


def encode(sprite: Sprite) -> bytes:
    ok, buf = cv2.imencode(".png", sprite.rgba)
    if not ok:
        raise RuntimeError("No se pudo codificar el sprite")
    return buf.tobytes()

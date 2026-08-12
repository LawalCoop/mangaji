"""Detección de viñetas, globos y texto con el modelo de segmentación, vía onnxruntime.

Corre sin Ultralytics (AGPL) ni torch: el `.pt` se exporta una sola vez a ONNX con
`mangacut export-onnx`, y el pipeline solo necesita onnxruntime + opencv.

El modelo exportado trae NMS incorporado — su salida es [1, 300, 38] con las detecciones
ya filtradas — así que no hace falta implementar supresión de no-máximos:

    columnas 0..3   bbox xyxy en píxeles de la entrada de 1280
    columna  4      confianza
    columna  5      clase (0 frame, 1 text, 2 balloon)
    columnas 6..37  coeficientes de máscara, que multiplican los prototipos de output1
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

CLASSES = {0: "frame", 1: "text", 2: "balloon"}
INPUT_SIZE = 1280

#: Umbral de confianza por clase.
#:
#: `text` va mucho más bajo a propósito: el modelo se entrenó sobre Manga109, es decir
#: japonés vertical, y con diálogo latino horizontal le baja la confianza — sobre todo en
#: los globos con más texto, que son los que más importan. Medido sobre una página con 12
#: globos, el umbral general de 0.25 dejaba 3 sin detectar y con 0.05 aparecen los 3.
#:
#: Bajarlo es seguro porque el texto solo se levanta del arte si su entorno es papel: un
#: falso positivo sobre el dibujo no se toca.
CONF_BY_CLASS = {"frame": 0.25, "balloon": 0.25, "text": 0.05}
#: Douglas-Peucker en píxeles. Medido sobre 94 viñetas: 202 vértices de mediana → 22,
#: conservando IoU 0.991 en el peor caso. Un épsilon proporcional al perímetro deforma
#: justo los contornos serpenteantes, que son los que más cuidado necesitan.
SIMPLIFY_EPS_PX = 2.0


@dataclass(slots=True)
class Detection:
    cls: str
    conf: float
    bbox: tuple[float, float, float, float]  # x, y, w, h en coords de la página
    polygon: list[tuple[int, int]]

    @property
    def area(self) -> float:
        return abs(cv2.contourArea(np.array(self.polygon, np.int32)))


def letterbox(img: np.ndarray, size: int = INPUT_SIZE) -> tuple[np.ndarray, float, int, int]:
    """Escala manteniendo proporción y rellena hasta el cuadrado de entrada.

    La imagen se ancla en la esquina superior izquierda, así que deshacer la
    transformación es dividir por la escala — sin restar desplazamientos.
    """
    h, w = img.shape[:2]
    scale = min(size / h, size / w)
    nh, nw = int(round(h * scale)), int(round(w * scale))
    canvas = np.full((size, size, 3), 114, np.uint8)
    canvas[:nh, :nw] = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_LINEAR)
    return canvas, scale, nh, nw


def clean_mask(mask: np.ndarray) -> np.ndarray:
    """Deja una sola región compacta.

    Las máscaras crudas traen hilos de 1 px y fragmentos sueltos: al contornearlos aparecen
    "puentes" que no aportan área pero sí trazan líneas que cruzan la página. La apertura
    los corta y quedarse con la componente mayor descarta los restos.
    """
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    opened = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    if not opened.any():
        opened = mask  # una viñeta muy fina no debe desaparecer por la limpieza

    n, labels, stats, _ = cv2.connectedComponentsWithStats(opened, connectivity=8)
    if n <= 2:
        return opened
    biggest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return (labels == biggest).astype(np.uint8)


#: Por encima de esta relación área/casco, la viñeta se considera convexa y se reemplaza
#: por su casco: los marcos de manga son rectos, y el casco los deja perfectamente rectos
#: en vez de seguir el escalonado de la máscara.
CONVEX_RATIO = 0.93


def mask_to_polygon(mask: np.ndarray, eps_px: float = SIMPLIFY_EPS_PX) -> list[tuple[int, int]]:
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return []
    contour = max(contours, key=cv2.contourArea)

    # Un marco de manga es un polígono de lados rectos. Si el contorno es casi convexo,
    # su casco es ese polígono ideal; seguir el borde crudo solo copia el escalonado que
    # deja la máscara de baja resolución.
    area = cv2.contourArea(contour)
    hull = cv2.convexHull(contour)
    hull_area = cv2.contourArea(hull)
    if hull_area > 0 and area / hull_area >= CONVEX_RATIO:
        contour = hull

    simple = cv2.approxPolyDP(contour, eps_px, True).reshape(-1, 2)
    if len(simple) < 3:
        return []
    return [(int(x), int(y)) for x, y in simple]


#: Clases que aporta el modelo de texto cuando se usa junto al de segmentación.
TEXT_MODEL_CLASSES = {0: "frame", 1: "text"}
#: Dos bloques de texto que se solapan más que esto son el mismo, visto por ambos modelos.
TEXT_MERGE_IOU = 0.4


def _bbox_iou(a: tuple[float, ...], b: tuple[float, ...]) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ix = max(0.0, min(ax + aw, bx + bw) - max(ax, bx))
    iy = max(0.0, min(ay + ah, by + bh) - max(ay, by))
    inter = ix * iy
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


def _merge_text(primary: list[Detection], extra: list[Detection]) -> list[Detection]:
    """Suma los bloques de texto de un segundo detector, sin duplicar los ya encontrados."""
    out = list(primary)
    existing = [d for d in primary if d.cls == "text"]
    for det in extra:
        if all(_bbox_iou(det.bbox, e.bbox) < TEXT_MERGE_IOU for e in existing):
            out.append(det)
            existing.append(det)
    return out


class TextDetector:
    """Detector dedicado al diálogo.

    El modelo de segmentación es el mejor para viñetas —da máscaras, y por eso salen los
    trapecios— pero con el texto de scanlations en español se queda corto: hay globos a los
    que les asigna 0.002 de confianza mientras un detector entrenado para texto les da 0.659.
    Se usa cada uno en lo que gana.

    Solo aporta cajas, sin máscara, que para un bloque de texto es suficiente: es
    rectangular por definición.
    """

    def __init__(self, model: str | Path, conf: float = 0.12, threads: int = 0):
        import onnxruntime as ort

        opts = ort.SessionOptions()
        if threads:
            opts.intra_op_num_threads = threads
        self.session = ort.InferenceSession(
            str(model), opts, providers=["CPUExecutionProvider"]
        )
        self.input_name = self.session.get_inputs()[0].name
        self.conf = conf

    def __call__(self, image: np.ndarray) -> list[Detection]:
        h0, w0 = image.shape[:2]
        canvas, scale, _, _ = letterbox(image)
        blob = canvas[:, :, ::-1].transpose(2, 0, 1)[None].astype(np.float32) / 255.0
        rows = self.session.run(None, {self.input_name: blob})[0][0]

        out: list[Detection] = []
        for row in rows:
            conf = float(row[4])
            if conf < self.conf or TEXT_MODEL_CLASSES.get(int(row[5])) != "text":
                continue
            x1, y1, x2, y2 = (float(v) / scale for v in row[:4])
            x1, y1 = max(x1, 0.0), max(y1, 0.0)
            x2, y2 = min(x2, float(w0)), min(y2, float(h0))
            if x2 - x1 < 2 or y2 - y1 < 2:
                continue
            out.append(
                Detection(
                    cls="text",
                    conf=conf,
                    bbox=(x1, y1, x2 - x1, y2 - y1),
                    polygon=[
                        (int(x1), int(y1)),
                        (int(x2), int(y1)),
                        (int(x2), int(y2)),
                        (int(x1), int(y2)),
                    ],
                )
            )
        return out


class Detector:
    """Envuelve la sesión de onnxruntime. Reutilizable entre páginas: crearla es lo caro."""

    def __init__(
        self,
        model: str | Path,
        conf: float = 0.25,
        threads: int = 0,
        conf_by_class: dict[str, float] | None = None,
        text_model: str | Path | None = None,
    ):
        import onnxruntime as ort

        opts = ort.SessionOptions()
        if threads:
            opts.intra_op_num_threads = threads
        self.session = ort.InferenceSession(
            str(model), opts, providers=["CPUExecutionProvider"]
        )
        self.input_name = self.session.get_inputs()[0].name
        self.conf = conf
        self.conf_by_class = {**CONF_BY_CLASS, **(conf_by_class or {})}
        self.floor = min(min(self.conf_by_class.values()), conf)
        # Con un modelo de texto dedicado, el diálogo lo aporta él y no este.
        self.text = TextDetector(text_model, threads=threads) if text_model else None

    def __call__(self, image: np.ndarray) -> list[Detection]:
        """`image` en BGR, tal como lo devuelve cv2.imread."""
        h0, w0 = image.shape[:2]
        canvas, scale, nh, nw = letterbox(image)

        blob = canvas[:, :, ::-1].transpose(2, 0, 1)[None].astype(np.float32) / 255.0
        preds, protos = self.session.run(None, {self.input_name: blob})

        rows = preds[0]
        rows = rows[rows[:, 4] >= self.floor]
        if len(rows) == 0:
            return []

        protos = protos[0]  # (32, 320, 320)
        pc, ph, pw = protos.shape
        flat = protos.reshape(pc, -1)

        # Región válida dentro del lienzo, en coordenadas de los prototipos.
        vh, vw = int(round(nh * ph / INPUT_SIZE)), int(round(nw * pw / INPUT_SIZE))
        vh, vw = max(vh, 1), max(vw, 1)

        out: list[Detection] = []
        for row in rows:
            x1, y1, x2, y2 = row[:4]
            conf, cls_id, coeffs = float(row[4]), int(row[5]), row[6:]

            name = CLASSES.get(cls_id, str(cls_id))
            if conf < self.conf_by_class.get(name, self.conf):
                continue

            logits = (coeffs @ flat).reshape(ph, pw)
            prob = 1.0 / (1.0 + np.exp(-logits))

            # Recortar a la caja evita que la máscara sangre a otras viñetas.
            bx1, by1 = int(x1 * pw / INPUT_SIZE), int(y1 * ph / INPUT_SIZE)
            bx2, by2 = int(np.ceil(x2 * pw / INPUT_SIZE)), int(np.ceil(y2 * ph / INPUT_SIZE))
            keep = np.zeros_like(prob)
            keep[max(by1, 0) : by2, max(bx1, 0) : bx2] = 1.0
            prob = prob[:vh, :vw] * keep[:vh, :vw]
            if not prob.any():
                continue

            # Interpolar la probabilidad y recién después umbralizar sitúa el borde con
            # precisión subpíxel. Escalar la máscara ya binarizada convertiría cada píxel
            # de los prototipos (1/4 de resolución) en un escalón visible.
            prob = cv2.resize(prob, (w0, h0), interpolation=cv2.INTER_LINEAR)
            mask = (prob > 0.5).astype(np.uint8)

            polygon = mask_to_polygon(clean_mask(mask))
            if not polygon:
                continue

            # La caja se deriva de la silueta y no de la salida cruda del modelo: esa se
            # sale de la hoja —llega a tener más ancho que la página, y coordenadas
            # negativas—, y entonces la cámara termina encuadrando un rectángulo que no
            # es la viñeta.
            bx, by, bw, bh = cv2.boundingRect(np.array(polygon, np.int32))

            out.append(
                Detection(
                    cls=name,
                    conf=conf,
                    # float() explícito: numpy devolvería float32, que json no serializa.
                    bbox=(float(bx), float(by), float(bw), float(bh)),
                    polygon=polygon,
                )
            )

        if self.text is not None:
            # Unión, no reemplazo: cada modelo encuentra bloques que el otro se pierde.
            # El de segmentación aporta máscara; el dedicado, los globos que aquel casi no
            # puntúa. Se quedan los dos y se descartan los repetidos.
            out = _merge_text(out, self.text(image))

        out.sort(key=lambda d: -d.conf)
        return out

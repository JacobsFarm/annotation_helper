"""Model-assisted prediction. The only module that touches ultralytics for inference.

Three pipelines, selectable per project:

    detect              boxes from a detection model
    segment             polygons from a segmentation model
    detect_then_segment detect, grow each box, segment the crop, map the mask back

The third existed in the predecessor as `predict_advanced_dual` and was never wired to
any button, which is a shame: it is the most useful of the three for small objects,
because the segmentation model sees a crop instead of a downscaled full frame.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from ..geometry import simplify
from ..shapes import Box, Polygon, Shape
from .protocol import ErrorCode, ProtocolError

ProgressFn = Callable[[str, int], None]

MODEL_CACHE_LIMIT = 3
"""Loaded models kept warm. Each YOLO model holds real GPU memory, so this is small."""

_MODEL_CACHE: dict[str, Any] = {}


@dataclass(slots=True)
class PredictOptions:
    pipeline: str = "detect"
    detect_model: str = ""
    segment_model: str = ""
    confidence: float = 0.25
    iou: float = 0.45
    max_detections: int = 300
    expand_ratio: float = 0.10
    simplify_tolerance: float = 1.5
    class_id: int = 0
    """Class assigned when the model's own class index has no project equivalent."""

    @classmethod
    def from_params(cls, params: dict[str, Any]) -> "PredictOptions":
        return cls(
            pipeline=str(params.get("pipeline", "detect")),
            detect_model=str(params.get("detectModel", "")),
            segment_model=str(params.get("segmentModel", "")),
            confidence=float(params.get("confidence", 0.25)),
            iou=float(params.get("iou", 0.45)),
            max_detections=int(params.get("maxDetections", 300)),
            expand_ratio=float(params.get("expandRatio", 0.10)),
            simplify_tolerance=float(params.get("simplifyTolerance", 1.5)),
            class_id=int(params.get("classId", 0)),
        )


def load_model(path: str):
    """Load lazily, keep warm, and turn every failure into a coded error.

    Importing ultralytics costs seconds and pulls in torch, so it must not happen at
    sidecar startup - the app has to be usable with no model configured at all.
    """
    if not path:
        raise ProtocolError(ErrorCode.MODEL_NOT_FOUND, "no model configured")

    cached = _MODEL_CACHE.get(path)
    if cached is not None:
        return cached

    model_file = Path(path)
    if not model_file.is_file():
        raise ProtocolError(ErrorCode.MODEL_NOT_FOUND, "model file not found", path)

    try:
        from ultralytics import YOLO  # noqa: PLC0415 - deliberately lazy
    except ImportError as exc:
        raise ProtocolError(
            ErrorCode.MISSING_DEPENDENCY,
            "ultralytics is not installed",
            "pip install annotation-helper[ai]",
        ) from exc

    try:
        model = YOLO(str(model_file))
    except Exception as exc:  # ultralytics raises a wide range of types
        raise ProtocolError(ErrorCode.MODEL_LOAD_FAILED, "could not load model", str(exc)) from exc

    if len(_MODEL_CACHE) >= MODEL_CACHE_LIMIT:
        _MODEL_CACHE.pop(next(iter(_MODEL_CACHE)))
    _MODEL_CACHE[path] = model
    return model


def unload_models() -> int:
    count = len(_MODEL_CACHE)
    _MODEL_CACHE.clear()
    return count


def predict(image: str, options: PredictOptions, progress: ProgressFn | None = None) -> dict[str, Any]:
    """Run a pipeline and return shapes in *image pixel* coordinates."""
    started = time.perf_counter()
    image_path = Path(image)
    if not image_path.is_file():
        raise ProtocolError(ErrorCode.IMAGE_NOT_FOUND, "image not found", image)

    def report(stage: str, pct: int) -> None:
        if progress:
            progress(stage, pct)

    if options.pipeline == "segment":
        shapes = _segment_full(image_path, options, report)
    elif options.pipeline == "detect_then_segment":
        shapes = _detect_then_segment(image_path, options, report)
    else:
        shapes = _detect(image_path, options, report)

    report("done", 100)
    return {
        "shapes": [s.to_dict() for s in shapes],
        "ms": int((time.perf_counter() - started) * 1000),
        "pipeline": options.pipeline,
    }


# --- pipelines --------------------------------------------------------------


def _detect(image_path: Path, options: PredictOptions, report: ProgressFn) -> list[Shape]:
    report("detect", 10)
    model = load_model(options.detect_model)
    result = _run(model, str(image_path), options)
    report("detect", 80)

    shapes: list[Shape] = []
    boxes = getattr(result, "boxes", None)
    if boxes is None:
        return shapes
    for xyxy, cls in zip(boxes.xyxy.tolist(), boxes.cls.tolist()):
        x1, y1, x2, y2 = xyxy
        shapes.append(
            Box(
                class_id=_map_class(int(cls), options),
                x1=float(x1),
                y1=float(y1),
                x2=float(x2),
                y2=float(y2),
                source="ai",
            )
        )
    return shapes


def _segment_full(image_path: Path, options: PredictOptions, report: ProgressFn) -> list[Shape]:
    report("segment", 10)
    model = load_model(options.segment_model or options.detect_model)
    result = _run(model, str(image_path), options)
    report("segment", 80)
    return _polygons_from(result, options, offset=(0.0, 0.0))


def _detect_then_segment(
    image_path: Path, options: PredictOptions, report: ProgressFn
) -> list[Shape]:
    """Detect on the full frame, then segment each grown crop and map masks back.

    The mapping back is where the predecessor's most visible bug lived: it added the
    horizontal offset to a vertical coordinate, so every predicted box rendered skewed.
    Here the offset is one tuple applied by one helper, which is the structural fix.
    """
    report("detect", 5)
    boxes = _detect(image_path, options, lambda *_: None)
    if not boxes:
        return []

    try:
        from PIL import Image  # noqa: PLC0415 - only this pipeline needs pixels
    except ImportError as exc:
        raise ProtocolError(
            ErrorCode.MISSING_DEPENDENCY,
            "pillow is required for detect_then_segment",
            "pip install annotation-helper[ai]",
        ) from exc

    segment_model = load_model(options.segment_model)
    shapes: list[Shape] = []

    with Image.open(image_path) as source:
        source = source.convert("RGB")
        width, height = source.size

        for index, box in enumerate(boxes):
            assert isinstance(box, Box)
            pct = 10 + int(85 * (index / max(len(boxes), 1)))
            report("segment", pct)

            crop_box = _expand(box, options.expand_ratio, width, height)
            crop = source.crop(crop_box)
            result = _run(segment_model, crop, options)
            polygons = _polygons_from(
                result, options, offset=(float(crop_box[0]), float(crop_box[1]))
            )
            if polygons:
                # Keep the largest mask per detection; a crop should contain one object.
                best = max(polygons, key=lambda p: p.area)
                best.class_id = box.class_id
                shapes.append(best)
            else:
                shapes.append(box)  # no mask found: the box is still useful

    return shapes


# --- helpers ----------------------------------------------------------------


def _run(model, source, options: PredictOptions):
    try:
        results = model.predict(
            source=source,
            conf=options.confidence,
            iou=options.iou,
            max_det=options.max_detections,
            verbose=False,
        )
    except Exception as exc:
        raise ProtocolError(ErrorCode.PREDICT_FAILED, "inference failed", str(exc)) from exc
    if not results:
        raise ProtocolError(ErrorCode.PREDICT_FAILED, "model returned no result")
    return results[0]


def _polygons_from(result, options: PredictOptions, offset: tuple[float, float]) -> list[Polygon]:
    """Convert ultralytics masks to polygons, offset into full-image coordinates."""
    masks = getattr(result, "masks", None)
    if masks is None or masks.xy is None:
        return []

    classes = []
    boxes = getattr(result, "boxes", None)
    if boxes is not None:
        classes = boxes.cls.tolist()

    off_x, off_y = offset
    polygons: list[Polygon] = []
    for index, contour in enumerate(masks.xy):
        points = [(float(x) + off_x, float(y) + off_y) for x, y in contour]
        if len(points) < 3:
            continue
        if options.simplify_tolerance > 0:
            points = simplify(points, options.simplify_tolerance)
        raw_class = int(classes[index]) if index < len(classes) else 0
        polygons.append(
            Polygon(class_id=_map_class(raw_class, options), points=points, source="ai")
        )
    return polygons


def _expand(box: Box, ratio: float, width: int, height: int) -> tuple[int, int, int, int]:
    """Grow a box by `ratio` on each side, clamped to the image."""
    b = box.normalised()
    pad_x, pad_y = b.width * ratio, b.height * ratio
    return (
        max(0, int(b.x1 - pad_x)),
        max(0, int(b.y1 - pad_y)),
        min(width, int(b.x2 + pad_x) + 1),
        min(height, int(b.y2 + pad_y) + 1),
    )


def _map_class(model_class: int, options: PredictOptions) -> int:
    """Model class index -> project class id.

    Today this is identity with a fallback, which is honest about what it does. A real
    per-model mapping table belongs in the project file; this is the single seam where
    it will plug in.
    """
    return model_class if model_class >= 0 else options.class_id

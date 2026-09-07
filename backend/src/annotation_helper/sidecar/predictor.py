"""Model-assisted prediction. The only module that touches ultralytics for inference.

Three pipelines, selectable per project:

    detect              boxes from a detection model
    segment             polygons from a segmentation model
    detect_then_segment detect, grow each box, segment the crop, map the mask back

The third existed in the predecessor as `predict_advanced_dual` and was never wired to
any button, which is a shame: it is the most useful of the three for small objects,
because the segmentation model sees a crop instead of a downscaled full frame.

Plus one interactive mode, `segment_at`: click a flower, get the flower. That one is
prompted by points instead of by a trained class list, so it needs no model of your own
and works on the first image of a brand-new project - which is exactly the moment a
detection model does not exist yet.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from ..geometry import polygon_area, simplify
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
    count = len(_MODEL_CACHE) + (1 if _SAM["predictor"] is not None else 0)
    _MODEL_CACHE.clear()
    release_sam()
    return count


# --- interactive segmentation (SAM) -----------------------------------------
#
# The expensive half of SAM is the image encoder, and it does not depend on where you
# clicked. So the predictor and the embedding of the current image are kept alive
# between calls: the first click on an image pays for the encoder, every click after it
# only pays for the mask decoder, which is milliseconds. Without that cache this is a
# two-second wait per click and nobody would use it twice.

DEFAULT_SAM_MODEL = "mobile_sam.pt"
"""~40 MB and quick on a CPU. Ultralytics fetches it on first use; `sam2.1_b.pt` and
friends are better and much heavier, and the project file can name any of them."""

_SAM: dict[str, Any] = {"predictor": None, "model": "", "image": ""}


def release_sam() -> None:
    predictor = _SAM["predictor"]
    if predictor is not None:
        try:
            predictor.reset_image()
        except Exception:  # a half-built predictor must still be droppable
            pass
    _SAM.update(predictor=None, model="", image="")


def _sam_predictor(model_name: str, image_path: Path):
    """A SAM predictor with this image's embedding already computed."""
    try:
        from ultralytics.models.sam import Predictor as SAMPredictor  # noqa: PLC0415
    except ImportError as exc:
        raise ProtocolError(
            ErrorCode.MISSING_DEPENDENCY,
            "ultralytics is not installed",
            "pip install annotation-helper[ai]",
        ) from exc

    # SAM 2 checkpoints need their own predictor. Selecting it by name keeps this working
    # on an ultralytics old enough not to have that class at all.
    predictor_class = SAMPredictor
    if "sam2" in model_name.lower():
        try:
            from ultralytics.models.sam import SAM2Predictor  # noqa: PLC0415

            predictor_class = SAM2Predictor
        except ImportError:
            pass

    if _SAM["predictor"] is None or _SAM["model"] != model_name:
        release_sam()
        try:
            predictor = predictor_class(
                overrides={
                    "task": "segment",
                    "mode": "predict",
                    "model": model_name,
                    "imgsz": 1024,
                    "conf": 0.25,
                    "save": False,
                    "verbose": False,
                }
            )
        except Exception as exc:
            raise ProtocolError(
                ErrorCode.MODEL_LOAD_FAILED, "could not load the SAM model", str(exc)
            ) from exc
        _SAM.update(predictor=predictor, model=model_name, image="")

    predictor = _SAM["predictor"]
    if _SAM["image"] != str(image_path):
        # Also where the weights are downloaded and the network is built, so a missing
        # checkpoint surfaces here rather than as a mystery at the first click.
        try:
            predictor.set_image(str(image_path))
        except Exception as exc:
            release_sam()
            raise ProtocolError(
                ErrorCode.MODEL_LOAD_FAILED,
                "could not prepare the image for SAM",
                str(exc),
            ) from exc
        _SAM["image"] = str(image_path)
    return predictor


def segment_at(
    image: str,
    points: list[tuple[float, float]],
    labels: list[int],
    model: str = "",
    simplify_tolerance: float = 1.5,
    class_id: int = 0,
) -> dict[str, Any]:
    """Segment whatever the clicks point at, and return one polygon.

    `labels` says what each click means: 1 "this is the object", 0 "this is background".
    Every click is sent again on every call, so the mask is always a function of the
    whole set - which is what makes a wrong click fixable by clicking again instead of
    by starting over.
    """
    started = time.perf_counter()
    image_path = Path(image)
    if not image_path.is_file():
        raise ProtocolError(ErrorCode.IMAGE_NOT_FOUND, "image not found", image)
    if not points:
        raise ProtocolError(ErrorCode.BAD_REQUEST, "no points given")
    if len(labels) != len(points):
        raise ProtocolError(ErrorCode.BAD_REQUEST, "points and labels differ in length")
    if not any(label == 1 for label in labels):
        raise ProtocolError(ErrorCode.BAD_REQUEST, "at least one positive point is required")

    predictor = _sam_predictor(model or DEFAULT_SAM_MODEL, image_path)

    # One nesting level = one object built from every click. A flat list is read as one
    # separate object per point, which is the opposite of what a refining click means.
    flat_points = [[float(x), float(y)] for x, y in points]
    flat_labels = [int(label) for label in labels]
    try:
        results = predictor(points=[flat_points], labels=[flat_labels])
    except Exception:
        # An ultralytics old enough to reshape every prompt into one-point-per-object
        # refuses the nested form. Flat still segments what the first click points at,
        # which is the common case, so degrade to it rather than to nothing.
        try:
            results = predictor(points=flat_points, labels=flat_labels)
        except Exception as exc:
            raise ProtocolError(
                ErrorCode.PREDICT_FAILED, "point segmentation failed", str(exc)
            ) from exc

    polygons = _sam_polygons(results[0] if results else None, simplify_tolerance, class_id)

    return {
        "shapes": [p.to_dict() for p in polygons],
        "ms": int((time.perf_counter() - started) * 1000),
        "model": model or DEFAULT_SAM_MODEL,
    }


MIN_RING_AREA = 25.0
"""Square pixels below which a blob is mask noise rather than a piece of the object."""

MIN_RING_SHARE = 0.05
"""A blob smaller than this fraction of the biggest one is not the thing you clicked."""

MAX_RINGS = 12
"""Enough for a leaf that grass cuts into pieces; not enough to bury the shape list."""


def _mask_rings(masks) -> list[list[list[tuple[float, float]]]]:
    """Per mask, every disjoint blob as its own ring, in image pixels.

    Deliberately not `masks.xy`. That property *concatenates* the separate contours of
    one mask into a single list of points, so a plant whose leaves are cut apart by
    grass comes back as one polygon that jumps from leaf to leaf - and those jumps are
    exactly the straight lines that run across the image and ruin the outline.

    Falls back to `masks.xy` when OpenCV is somehow missing, which is the old, uglier
    result rather than no result at all.
    """
    try:
        import cv2  # noqa: PLC0415 - ships with ultralytics, still not worth importing early
        from ultralytics.utils import ops  # noqa: PLC0415
    except ImportError:
        return [[[(float(x), float(y)) for x, y in contour]] for contour in (masks.xy or [])]

    out: list[list[list[tuple[float, float]]]] = []
    for mask in masks.data.int().cpu().numpy().astype("uint8"):
        # RETR_EXTERNAL: outlines, not the holes inside them. A YOLO polygon cannot
        # express a hole anyway, so finding them would only produce unstorable rings.
        contours = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[-2]
        rings: list[list[tuple[float, float]]] = []
        for contour in contours:
            points = contour.reshape(-1, 2).astype("float32")
            if len(points) < 3:
                continue
            # The mask is at the network's resolution; a shape is in image pixels. Same
            # conversion `masks.xy` does, on one contour instead of all of them at once.
            scaled = ops.scale_coords(mask.shape, points, masks.orig_shape, normalize=False)
            rings.append([(float(x), float(y)) for x, y in scaled])
        out.append(rings)
    return out


def _ring_to_polygon(
    ring: list[tuple[float, float]], tolerance: float, class_id: int
) -> Polygon | None:
    points = simplify(ring, tolerance) if tolerance > 0 else list(ring)
    if len(points) < 3:
        return None
    polygon = Polygon(class_id=class_id, points=points, source="ai")
    return polygon if polygon.area >= MIN_RING_AREA else None


def _sam_polygons(result, tolerance: float, class_id: int) -> list[Polygon]:
    """Masks to polygons, one per disjoint blob, biggest first.

    Unlike `_polygons_from` the class comes from the caller: SAM segments a thing, it
    does not name it. And unlike a detection, one click can legitimately mean several
    rings - a weed in grass is one plant and five visible pieces of leaf. They are
    returned separately because a single ring around all of them would have to cut
    straight across the grass in between, and because YOLO stores one ring per line.
    """
    masks = getattr(result, "masks", None) if result is not None else None
    if masks is None:
        return []

    # Several masks are competing answers to the same clicks, not parts of one answer,
    # so the rings never mix: the mask that covers the most is the one that gets used.
    per_mask: list[list[Polygon]] = []
    for rings in _mask_rings(masks):
        polygons = [
            polygon
            for ring in rings
            if (polygon := _ring_to_polygon(ring, tolerance, class_id)) is not None
        ]
        if polygons:
            per_mask.append(polygons)
    if not per_mask:
        return []

    chosen = max(per_mask, key=lambda group: sum(p.area for p in group))
    chosen.sort(key=lambda p: p.area, reverse=True)
    floor = chosen[0].area * MIN_RING_SHARE
    return [p for p in chosen if p.area >= floor][:MAX_RINGS]


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
    """Convert ultralytics masks to polygons, offset into full-image coordinates.

    One detection is one instance and a YOLO polygon is one ring, so a mask that falls
    apart into several blobs contributes its largest. The rest is mask noise, and
    stitching them into one ring would write a line straight through the image.
    """
    masks = getattr(result, "masks", None)
    if masks is None:
        return []

    classes = []
    boxes = getattr(result, "boxes", None)
    if boxes is not None:
        classes = boxes.cls.tolist()

    off_x, off_y = offset
    polygons: list[Polygon] = []
    for index, rings in enumerate(_mask_rings(masks)):
        if not rings:
            continue
        biggest = max(rings, key=polygon_area)
        points = [(x + off_x, y + off_y) for x, y in biggest]
        if options.simplify_tolerance > 0:
            points = simplify(points, options.simplify_tolerance)
        if len(points) < 3:
            continue
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

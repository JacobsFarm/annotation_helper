"""YOLO label I/O - the only module that knows about normalised coordinates.

Formats handled, both in the same file if need be:

    box      `class cx cy w h`                  (5 tokens)
    polygon  `class x1 y1 x2 y2 x3 y3 ...`      (odd, >= 7 tokens)

Rules that the rest of the app relies on:

* Reading is always attempted. A label file is the source of truth, never write-only.
* A malformed row produces an `LabelIssue` and is skipped; it never raises.
* An existing but empty file is a *verified background* sample, not "no data".
* `read` -> `write` -> `read` is lossless within float tolerance.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from .geometry import clamp
from .shapes import Box, ImageAnnotation, Polygon, Shape, ShapeSource

PRECISION = 6
"""Decimals written per coordinate. 6 is ~0.004 px of error on an 8K image."""

IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff")


@dataclass(slots=True)
class LabelIssue:
    """A structured problem, not a sentence. The UI translates `code`."""

    code: str
    line: int
    detail: str = ""

    def to_dict(self) -> dict[str, object]:
        return {"code": self.code, "line": self.line, "detail": self.detail}


@dataclass(slots=True)
class LabelReadResult:
    shapes: list[Shape] = field(default_factory=list)
    issues: list[LabelIssue] = field(default_factory=list)
    existed: bool = False

    @property
    def is_background(self) -> bool:
        """File exists, parsed cleanly, and holds nothing: a verified negative sample."""
        return self.existed and not self.shapes and not self.issues


def label_path_for(image_path: Path, labels_dir: Path | None = None) -> Path:
    """The `.txt` that belongs to an image.

    With `labels_dir` omitted the label sits next to the image, which is what the
    ultralytics `images/` + `labels/` convention degrades to for a flat folder.
    """
    target_dir = labels_dir if labels_dir is not None else image_path.parent
    return target_dir / (image_path.stem + ".txt")


def parse_label_text(text: str, width: int, height: int, source: ShapeSource = "manual") -> LabelReadResult:
    """Parse label file contents into pixel-space shapes."""
    result = LabelReadResult(existed=True)
    if width <= 0 or height <= 0:
        result.issues.append(LabelIssue("bad_image_size", 0, f"{width}x{height}"))
        return result

    for line_no, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue

        parts = line.split()
        try:
            class_id = int(float(parts[0]))
            values = [float(p) for p in parts[1:]]
        except (ValueError, IndexError):
            result.issues.append(LabelIssue("malformed_row", line_no, line[:80]))
            continue

        if class_id < 0:
            result.issues.append(LabelIssue("negative_class_id", line_no, str(class_id)))
            continue

        out_of_range = [v for v in values if v < -0.001 or v > 1.001]

        if len(values) == 4:
            cx, cy, w, h = values
            if w <= 0 or h <= 0:
                result.issues.append(LabelIssue("degenerate_box", line_no, f"{w}x{h}"))
                continue
            shape: Shape = Box(
                class_id=class_id,
                x1=(cx - w / 2) * width,
                y1=(cy - h / 2) * height,
                x2=(cx + w / 2) * width,
                y2=(cy + h / 2) * height,
                source=source,
            )
        elif len(values) >= 6 and len(values) % 2 == 0:
            points = [
                (values[i] * width, values[i + 1] * height) for i in range(0, len(values), 2)
            ]
            shape = Polygon(class_id=class_id, points=points, source=source)
        else:
            result.issues.append(LabelIssue("unexpected_token_count", line_no, str(len(parts))))
            continue

        if out_of_range:
            result.issues.append(
                LabelIssue("coordinate_out_of_range", line_no, f"{len(out_of_range)} value(s)")
            )
        result.shapes.append(shape)

    return result


def format_label_text(shapes: list[Shape], width: int, height: int) -> str:
    """Serialise pixel-space shapes to YOLO text. Empty list -> empty string."""
    if width <= 0 or height <= 0:
        raise ValueError("image size must be positive")

    lines: list[str] = []
    for shape in shapes:
        if isinstance(shape, Box):
            box = shape.normalised()
            cx = clamp(((box.x1 + box.x2) / 2) / width)
            cy = clamp(((box.y1 + box.y2) / 2) / height)
            w = clamp(box.width / width)
            h = clamp(box.height / height)
            if w <= 0 or h <= 0:
                continue
            values = (cx, cy, w, h)
        elif isinstance(shape, Polygon):
            if len(shape.points) < 3:
                continue
            values = tuple(
                v
                for x, y in shape.points
                for v in (clamp(x / width), clamp(y / height))
            )
        else:  # pragma: no cover - Shape is a closed union
            raise TypeError(f"unsupported shape: {type(shape).__name__}")

        body = " ".join(f"{v:.{PRECISION}f}" for v in values)
        lines.append(f"{shape.class_id} {body}")

    return "\n".join(lines) + ("\n" if lines else "")


def read_labels(
    path: Path, width: int, height: int, source: ShapeSource = "manual"
) -> LabelReadResult:
    """Read a label file. A missing file is a normal, non-error state."""
    if not path.is_file():
        return LabelReadResult(existed=False)
    return parse_label_text(path.read_text(encoding="utf-8"), width, height, source)


def write_labels(path: Path, shapes: list[Shape], width: int, height: int) -> Path:
    """Write atomically: temp file in the same directory, then rename over the target.

    On Windows `os.replace` maps to MOVEFILE_REPLACE_EXISTING, so a crash mid-write
    can never leave a half-written label behind.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    text = format_label_text(shapes, width, height)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(text, encoding="utf-8", newline="\n")
    temp.replace(path)
    return path


def read_annotation(
    image_path: Path, width: int, height: int, labels_dir: Path | None = None
) -> ImageAnnotation:
    """Load one image's annotation, including the reviewed/background distinction."""
    result = read_labels(label_path_for(image_path, labels_dir), width, height)
    return ImageAnnotation(
        image_file=image_path.name,
        width=width,
        height=height,
        shapes=result.shapes,
        reviewed=result.existed,
    )


def write_annotation(
    image_path: Path, annotation: ImageAnnotation, labels_dir: Path | None = None
) -> Path:
    """Save one image's annotation. Writing an empty file is deliberate, not a no-op."""
    return write_labels(
        label_path_for(image_path, labels_dir),
        annotation.shapes,
        annotation.width,
        annotation.height,
    )

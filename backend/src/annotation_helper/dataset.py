"""Dataset-level operations: scan, index, health check, split.

All of these run headless. The GUI's Dataset screen calls exactly the same functions
the CLI does, so nothing can behave differently in one and not the other.
"""

from __future__ import annotations

import json
import random
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator, Literal

from .imageinfo import image_size
from .labels import IMAGE_EXTENSIONS, boxes_only_text, label_path_for, read_labels
from .project import Project
from .shapes import AnnotationKind, count_kinds, kind_from_counts, trains_segmentation

INDEX_VERSION = 2


@dataclass(slots=True)
class ImageEntry:
    """One row of the dataset index."""

    file: str  # relative to the images directory, so the index survives a folder move
    width: int
    height: int
    mtime: float
    size: int
    shape_count: int = 0
    labelled: bool = False  # a label file exists (possibly empty = verified background)
    box_count: int = 0
    polygon_count: int = 0

    @property
    def kind(self) -> AnnotationKind:
        """Which task this image can train. See `shapes.AnnotationKind`."""
        return kind_from_counts(self.box_count, self.polygon_count, self.labelled)

    def to_dict(self) -> dict[str, Any]:
        return {
            "file": self.file,
            "width": self.width,
            "height": self.height,
            "mtime": self.mtime,
            "size": self.size,
            "shapeCount": self.shape_count,
            "labelled": self.labelled,
            "boxCount": self.box_count,
            "polygonCount": self.polygon_count,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ImageEntry":
        return cls(
            file=str(data["file"]),
            width=int(data["width"]),
            height=int(data["height"]),
            mtime=float(data["mtime"]),
            size=int(data["size"]),
            shape_count=int(data.get("shapeCount", 0)),
            labelled=bool(data.get("labelled", False)),
            box_count=int(data.get("boxCount", 0)),
            polygon_count=int(data.get("polygonCount", 0)),
        )


def iter_images(images_dir: Path, recursive: bool = True) -> Iterator[Path]:
    """Every image under `images_dir`, in a stable sorted order.

    Sorted, because "next image" must mean the same thing on every machine and after
    every rescan; `Path.rglob` order is filesystem-dependent.
    """
    if not images_dir.is_dir():
        return
    pattern = "**/*" if recursive else "*"
    for path in sorted(images_dir.glob(pattern), key=lambda p: str(p).lower()):
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS:
            yield path


def scan(project: Project, recursive: bool = True) -> list[ImageEntry]:
    """Read every image header and its label file. O(n) file touches, no decoding."""
    entries: list[ImageEntry] = []
    for path in iter_images(project.images_dir, recursive):
        size = image_size(path)
        if size is None:
            continue
        width, height = size
        stat = path.stat()
        label = read_labels(label_path_for(path, project.labels_dir), width, height)
        boxes, polygons = count_kinds(label.shapes)
        entries.append(
            ImageEntry(
                file=path.relative_to(project.images_dir).as_posix(),
                width=width,
                height=height,
                mtime=stat.st_mtime,
                size=stat.st_size,
                shape_count=len(label.shapes),
                labelled=label.existed,
                box_count=boxes,
                polygon_count=polygons,
            )
        )
    return entries


# --- index ------------------------------------------------------------------
#
# Re-scanning 50k files on every load is too slow, and SQLite would mean a native
# module and therefore a C++ toolchain for anyone running `npm install`. A JSON index
# invalidated per entry on mtime holds to ~100k images and keeps the build toolchain-free.


def index_path(project: Project) -> Path:
    return project.state_dir / "index.json"


def load_index(project: Project) -> dict[str, ImageEntry]:
    path = index_path(project)
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}  # a corrupt cache is not an error; it is a cache miss
    if data.get("version") != INDEX_VERSION:
        return {}
    return {e["file"]: ImageEntry.from_dict(e) for e in data.get("entries", [])}


def save_index(project: Project, entries: list[ImageEntry]) -> Path:
    path = index_path(project)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": INDEX_VERSION,
        "images": project.paths.images,
        "entries": [e.to_dict() for e in entries],
    }
    temp = path.with_suffix(".json.tmp")
    temp.write_text(json.dumps(payload), encoding="utf-8", newline="\n")
    temp.replace(path)
    return path


def refresh_index(project: Project, recursive: bool = True) -> list[ImageEntry]:
    """Reuse cached rows whose image is unchanged; re-read the rest.

    Label state is always re-read: labels change far more often than images, and a
    stale "labelled" flag is exactly the kind of lie that costs an afternoon.
    """
    cached = load_index(project)
    entries: list[ImageEntry] = []

    for path in iter_images(project.images_dir, recursive):
        rel = path.relative_to(project.images_dir).as_posix()
        stat = path.stat()
        hit = cached.get(rel)

        if hit and hit.mtime == stat.st_mtime and hit.size == stat.st_size:
            width, height = hit.width, hit.height
        else:
            size = image_size(path)
            if size is None:
                continue
            width, height = size

        label = read_labels(label_path_for(path, project.labels_dir), width, height)
        boxes, polygons = count_kinds(label.shapes)
        entries.append(
            ImageEntry(
                file=rel,
                width=width,
                height=height,
                mtime=stat.st_mtime,
                size=stat.st_size,
                shape_count=len(label.shapes),
                labelled=label.existed,
                box_count=boxes,
                polygon_count=polygons,
            )
        )

    save_index(project, entries)
    return entries


# --- health check -----------------------------------------------------------

IssueLevel = Literal["error", "warning"]


@dataclass(slots=True)
class DatasetIssue:
    """Structured, translatable. `code` is the key, `detail` fills the parameters."""

    code: str
    level: IssueLevel
    file: str
    detail: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {"code": self.code, "level": self.level, "file": self.file, "detail": self.detail}


@dataclass(slots=True)
class HealthReport:
    images: int = 0
    labelled: int = 0
    backgrounds: int = 0
    shapes: int = 0
    boxes: int = 0
    polygons: int = 0
    per_class: dict[int, int] = field(default_factory=dict)
    per_kind: dict[str, int] = field(default_factory=dict)
    """Labelled images per `AnnotationKind`: box, polygon, mixed, background."""
    issues: list[DatasetIssue] = field(default_factory=list)

    @property
    def unlabelled(self) -> int:
        return self.images - self.labelled

    @property
    def errors(self) -> int:
        return sum(1 for i in self.issues if i.level == "error")

    def to_dict(self) -> dict[str, Any]:
        return {
            "images": self.images,
            "labelled": self.labelled,
            "unlabelled": self.unlabelled,
            "backgrounds": self.backgrounds,
            "shapes": self.shapes,
            "boxes": self.boxes,
            "polygons": self.polygons,
            "perClass": {str(k): v for k, v in sorted(self.per_class.items())},
            "perKind": dict(self.per_kind),
            "issues": [i.to_dict() for i in self.issues],
        }


def health_check(project: Project, recursive: bool = True) -> HealthReport:
    """Find the problems that silently poison a training run.

    Available from day one on purpose: catching bad data before annotating 500 images
    on top of it is worth far more than it costs.
    """
    report = HealthReport()
    known_classes = {c.id for c in project.classes}
    seen_labels: set[Path] = set()
    segmenting = project.task in ("segment", "both")

    for path in iter_images(project.images_dir, recursive):
        report.images += 1
        rel = path.relative_to(project.images_dir).as_posix()

        size = image_size(path)
        if size is None:
            report.issues.append(DatasetIssue("unreadable_image", "error", rel))
            continue
        width, height = size

        label_file = label_path_for(path, project.labels_dir)
        seen_labels.add(label_file.resolve())
        result = read_labels(label_file, width, height)

        if not result.existed:
            report.issues.append(DatasetIssue("missing_label", "warning", rel))
            continue

        report.labelled += 1
        if result.is_background:
            report.backgrounds += 1

        for issue in result.issues:
            report.issues.append(
                DatasetIssue(issue.code, "error", rel, f"line {issue.line}: {issue.detail}")
            )

        for shape in result.shapes:
            report.shapes += 1
            report.per_class[shape.class_id] = report.per_class.get(shape.class_id, 0) + 1
            if shape.class_id not in known_classes:
                report.issues.append(
                    DatasetIssue("unknown_class_id", "error", rel, str(shape.class_id))
                )

        boxes, polygons = count_kinds(result.shapes)
        report.boxes += boxes
        report.polygons += polygons
        kind = kind_from_counts(boxes, polygons)
        report.per_kind[kind] = report.per_kind.get(kind, 0) + 1

        # Boxes and polygons in one file are legal on disk and fine for detection, where
        # a polygon is read as its bounding box anyway. For segmentation they are not:
        # ultralytics decides per file, so the box rows are re-read as two-point polygons
        # and silently become nonsense. That is an error worth stopping for.
        if kind == "mixed":
            report.issues.append(
                DatasetIssue(
                    "mixed_shape_kinds",
                    "error" if segmenting else "warning",
                    rel,
                    f"{boxes} box, {polygons} polygon",
                )
            )
        elif segmenting and kind == "box":
            report.issues.append(DatasetIssue("box_only_image", "warning", rel, str(boxes)))

    # Orphan labels: a label whose image was deleted or renamed still trains as data.
    if project.labels_dir.is_dir():
        for label_file in sorted(project.labels_dir.rglob("*.txt")):
            if label_file.resolve() not in seen_labels:
                rel = label_file.relative_to(project.labels_dir).as_posix()
                report.issues.append(DatasetIssue("orphan_label", "warning", rel))

    return report


# --- split ------------------------------------------------------------------


ShapeSelection = Literal["any", "segment", "detect"]
"""Which half of the work a split is for.

    any      everything as annotated - boxes stay boxes, polygons stay polygons
    segment  only images a mask can be learned from: polygon-only, plus backgrounds
    detect   everything, with each polygon written out as its bounding box

`detect` is the direction that costs nothing; there is no `segment` counterpart,
because a box cannot be turned back into the mask it never held.
"""


@dataclass(slots=True)
class SplitResult:
    train: int = 0
    val: int = 0
    test: int = 0
    skipped: int = 0
    skipped_kind: int = 0
    """Labelled images left out because their shapes cannot train the chosen task."""
    converted: int = 0
    """Images whose polygons were written out as boxes."""
    output: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "train": self.train,
            "val": self.val,
            "test": self.test,
            "skipped": self.skipped,
            "skippedKind": self.skipped_kind,
            "converted": self.converted,
            "output": self.output,
        }


def label_kind(label_file: Path) -> AnnotationKind:
    """The shape kinds in one label file.

    Parsed at 1 x 1 on purpose: only the tallies are wanted here, and how many rows are
    boxes does not depend on the image size. Saves an image header read per file.
    """
    return kind_from_counts(*count_kinds(read_labels(label_file, 1, 1).shapes))


def _apportion(count: int, ratios: dict[str, float]) -> dict[str, int]:
    """Split `count` items over `ratios` by largest remainder.

    Flooring each share and dumping the rest into the last bucket looks harmless until
    a small dataset arrives: 6 images at 0.80/0.15/0.05 floors to 4/0/0 and hands the
    remaining 2 to *test*, the smallest share. Largest remainder gives 5/1/0, which is
    what the ratios actually asked for.
    """
    total = sum(ratios.values())
    if total <= 0 or count <= 0:
        return {name: 0 for name in ratios}

    exact = {name: count * ratio / total for name, ratio in ratios.items()}
    sizes = {name: int(value) for name, value in exact.items()}

    remaining = count - sum(sizes.values())
    order = sorted(ratios, key=lambda name: (exact[name] - sizes[name], ratios[name]), reverse=True)
    for name in order[:remaining]:
        sizes[name] += 1
    return sizes


def split_dataset(
    project: Project,
    output: Path | None = None,
    mode: Literal["copy", "move", "lists"] = "copy",
    include_unlabelled: bool = False,
    recursive: bool = True,
    shapes: ShapeSelection = "any",
) -> SplitResult:
    """Produce an ultralytics-shaped train/val/test dataset.

    `mode`:
        copy   - duplicate images and labels into `dataset/<split>/images|labels`
        move   - same layout, but the source folder is emptied
        lists  - write `train.txt` / `val.txt` / `test.txt` with absolute paths and
                 touch nothing else. Cheapest for large datasets.

    `shapes` picks which annotations belong in this dataset; see `ShapeSelection`. It
    filters and converts on the way *out*, never in `labels/`: the annotation on disk
    stays the richest form of the work, and a detection dataset is a view of it.

    Ratios and seed come from the project file, so a split is reproducible: same seed,
    same dataset, same partition.
    """
    if shapes == "detect" and mode == "lists":
        raise ValueError(
            "shapes='detect' rewrites label files, which 'lists' mode never copies; "
            "use copy or move"
        )
    target = Path(output) if output else project.output_dir
    ratios = project.split
    total_ratio = ratios.train + ratios.val + ratios.test
    if total_ratio <= 0:
        raise ValueError("split ratios must add up to more than zero")

    candidates: list[Path] = []
    kinds: dict[Path, AnnotationKind] = {}
    skipped = 0
    skipped_kind = 0
    for path in iter_images(project.images_dir, recursive):
        label = label_path_for(path, project.labels_dir)
        if not label.is_file():
            if include_unlabelled:
                candidates.append(path)
            else:
                skipped += 1
            continue
        if shapes != "any":
            kinds[path] = label_kind(label)
            if shapes == "segment" and not trains_segmentation(kinds[path]):
                skipped_kind += 1
                continue
        candidates.append(path)

    rng = random.Random(ratios.seed)
    rng.shuffle(candidates)

    sizes = _apportion(
        len(candidates),
        {"train": ratios.train, "val": ratios.val, "test": ratios.test},
    )
    offset = 0
    buckets: dict[str, list[Path]] = {}
    for name in ("train", "val", "test"):
        buckets[name] = candidates[offset : offset + sizes[name]]
        offset += sizes[name]

    target.mkdir(parents=True, exist_ok=True)
    converted = 0

    if mode == "lists":
        for name, items in buckets.items():
            listing = target / f"{name}.txt"
            listing.write_text(
                "".join(f"{p.resolve().as_posix()}\n" for p in items),
                encoding="utf-8",
                newline="\n",
            )
    else:
        import shutil

        transfer = shutil.move if mode == "move" else shutil.copy2
        for name, items in buckets.items():
            images_out = target / name / "images"
            labels_out = target / name / "labels"
            images_out.mkdir(parents=True, exist_ok=True)
            labels_out.mkdir(parents=True, exist_ok=True)
            for image in items:
                transfer(str(image), str(images_out / image.name))
                label = label_path_for(image, project.labels_dir)
                if not label.is_file():
                    continue
                if shapes == "detect":
                    (labels_out / label.name).write_text(
                        boxes_only_text(label.read_text(encoding="utf-8")),
                        encoding="utf-8",
                        newline="\n",
                    )
                    if kinds.get(image) in ("polygon", "mixed"):
                        converted += 1
                    if mode == "move":
                        label.unlink()
                else:
                    transfer(str(label), str(labels_out / label.name))

    project.write_data_yaml(target=project.root / "data.yaml", splits_root=target)

    return SplitResult(
        train=len(buckets["train"]),
        val=len(buckets["val"]),
        test=len(buckets["test"]),
        skipped=skipped,
        skipped_kind=skipped_kind,
        converted=converted,
        output=str(target),
    )

"""The project file: `annotation.project.json`.

Design rules, so a project stays usable without this application:

* Every path in the file is *relative to the project folder*. Copy the folder to
  another machine and it still opens.
* The layout is plain ultralytics: `images/`, `labels/`, `classes.txt`, `data.yaml`.
  Any other YOLO tool can read the result; nothing is locked into a private format.
* Application state that is not data - caches, journals, trash - lives in
  `.annotation-helper/` and can be deleted at any time without losing work.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field, replace
from pathlib import Path
from typing import Any

PROJECT_FILENAME = "annotation.project.json"
STATE_DIRNAME = ".annotation-helper"
FORMAT_VERSION = 1

DEFAULT_CLASS_COLORS = [
    "#386938", "#c98a1b", "#3b7f8c", "#8c4a3b", "#5d5b8c",
    "#7a8c3b", "#8c3b6e", "#3b558c", "#8c7a3b", "#4a8c6e",
]


@dataclass(slots=True)
class ProjectClass:
    id: int
    name: str
    color: str = DEFAULT_CLASS_COLORS[0]


@dataclass(slots=True)
class ProjectPaths:
    input: str = "input"  # the inbox; annotating moves an image out of it
    images: str = "images"
    labels: str = "labels"
    recycle: str = "recycle"  # the bin; nothing is unlinked without an explicit empty
    output: str = "dataset"


@dataclass(slots=True)
class AiSettings:
    """Every threshold is a project setting.

    The predecessor hardcoded four different confidence values in four places; this is
    the single home for all of them.
    """

    pipeline: str = "detect"  # detect | segment | detect_then_segment
    detect_model: str = ""
    segment_model: str = ""
    confidence: float = 0.25
    iou: float = 0.45
    max_detections: int = 300
    expand_ratio: float = 0.10  # box growth before the segment crop, pipeline 3 only
    simplify_tolerance: float = 1.5  # pixels; 0 keeps every predicted vertex
    sam_model: str = "mobile_sam.pt"  # click-to-segment; an ultralytics name or a path


@dataclass(slots=True)
class SplitSettings:
    train: float = 0.80
    val: float = 0.15
    test: float = 0.05
    seed: int = 1337


@dataclass(slots=True)
class TrainingSettings:
    model: str = "yolo11n.pt"
    epochs: int = 100
    imgsz: int = 640
    batch: int = 16
    device: str = ""  # "" lets ultralytics choose; "0" or "cpu" to force
    patience: int = 50
    run_name: str = "train"


@dataclass(slots=True)
class Project:
    root: Path
    name: str = "Untitled project"
    task: str = "detect"  # detect | segment | both
    classes: list[ProjectClass] = field(default_factory=lambda: [ProjectClass(0, "object")])
    paths: ProjectPaths = field(default_factory=ProjectPaths)
    ai: AiSettings = field(default_factory=AiSettings)
    split: SplitSettings = field(default_factory=SplitSettings)
    training: TrainingSettings = field(default_factory=TrainingSettings)
    format_version: int = FORMAT_VERSION

    # --- resolved locations -------------------------------------------------

    @property
    def file(self) -> Path:
        return self.root / PROJECT_FILENAME

    @property
    def input_dir(self) -> Path:
        """The inbox. Images wait here until they are annotated."""
        return self.root / self.paths.input

    @property
    def images_dir(self) -> Path:
        return self.root / self.paths.images

    @property
    def labels_dir(self) -> Path:
        return self.root / self.paths.labels

    @property
    def output_dir(self) -> Path:
        return self.root / self.paths.output

    @property
    def state_dir(self) -> Path:
        return self.root / STATE_DIRNAME

    @property
    def recycle_dir(self) -> Path:
        """The bin. A visible folder: what lands here is the user's data, not app state."""
        return self.root / self.paths.recycle

    @property
    def trash_dir(self) -> Path:
        """Kept as the old name for callers; the bin itself moved out of state_dir."""
        return self.recycle_dir

    def class_name(self, class_id: int) -> str:
        for c in self.classes:
            if c.id == class_id:
                return c.name
        return f"class_{class_id}"

    def class_names(self) -> list[str]:
        """Names ordered by id, with gaps filled, because YOLO indexes by position."""
        if not self.classes:
            return []
        highest = max(c.id for c in self.classes)
        return [self.class_name(i) for i in range(highest + 1)]

    # --- persistence --------------------------------------------------------

    def to_dict(self) -> dict[str, Any]:
        return {
            "formatVersion": self.format_version,
            "name": self.name,
            "task": self.task,
            "classes": [asdict(c) for c in self.classes],
            "paths": asdict(self.paths),
            "ai": _camel(asdict(self.ai)),
            "split": asdict(self.split),
            "training": _camel(asdict(self.training)),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any], root: Path) -> "Project":
        classes = [
            ProjectClass(
                id=int(c.get("id", i)),
                name=str(c.get("name", f"class_{i}")),
                color=str(c.get("color", DEFAULT_CLASS_COLORS[i % len(DEFAULT_CLASS_COLORS)])),
            )
            for i, c in enumerate(data.get("classes", []))
        ] or [ProjectClass(0, "object")]

        return cls(
            root=root,
            name=str(data.get("name", root.name)),
            task=str(data.get("task", "detect")),
            classes=classes,
            paths=_build(ProjectPaths, data.get("paths", {})),
            ai=_build(AiSettings, data.get("ai", {})),
            split=_build(SplitSettings, data.get("split", {})),
            training=_build(TrainingSettings, data.get("training", {})),
            format_version=int(data.get("formatVersion", FORMAT_VERSION)),
        )

    @classmethod
    def load(cls, path: Path) -> "Project":
        """Accepts either the project file or the folder that holds it."""
        path = Path(path)
        file = path / PROJECT_FILENAME if path.is_dir() else path
        if not file.is_file():
            raise FileNotFoundError(f"no {PROJECT_FILENAME} at {path}")
        data = json.loads(file.read_text(encoding="utf-8"))
        return cls.from_dict(data, file.parent)

    def save(self) -> Path:
        """Atomic write, then refresh the two files other tools read."""
        self.root.mkdir(parents=True, exist_ok=True)
        temp = self.file.with_suffix(".json.tmp")
        temp.write_text(
            json.dumps(self.to_dict(), indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        temp.replace(self.file)
        self.write_classes_txt()
        return self.file

    def write_classes_txt(self) -> Path:
        """A plain one-name-per-line mirror. Half the YOLO ecosystem expects it."""
        target = self.root / "classes.txt"
        target.write_text("\n".join(self.class_names()) + "\n", encoding="utf-8", newline="\n")
        return target

    def write_data_yaml(self, target: Path | None = None, splits_root: Path | None = None) -> Path:
        """Write the ultralytics dataset descriptor.

        Hand-rolled rather than pulling in PyYAML: the file is a handful of lines and
        the core package stays dependency-free.
        """
        target = target or (self.root / "data.yaml")
        base = splits_root or self.output_dir
        names = self.class_names()
        lines = [
            "# Generated by Annotation Helper. Safe to edit; regenerating overwrites it.",
            f"path: {_yaml_path(base)}",
            "train: train/images",
            "val: val/images",
        ]
        if self.split.test > 0:
            lines.append("test: test/images")
        lines.append(f"nc: {len(names)}")
        lines.append("names:")
        lines.extend(f"  {i}: {name}" for i, name in enumerate(names))
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
        return target

    def with_changes(self, **changes: Any) -> "Project":
        return replace(self, **changes)


def create_project(root: Path, name: str | None = None, task: str = "detect") -> Project:
    """Lay out a new project folder. Idempotent: re-running never destroys data."""
    root = Path(root)
    project = Project(root=root, name=name or root.name, task=task)
    for directory in (
        project.input_dir,
        project.images_dir,
        project.labels_dir,
        project.recycle_dir,
        project.state_dir,
    ):
        directory.mkdir(parents=True, exist_ok=True)
    (project.state_dir / ".gitignore").write_text("*\n", encoding="utf-8", newline="\n")
    if project.file.exists():
        return Project.load(project.file)
    project.save()
    return project


def find_project(start: Path) -> Path | None:
    """Walk up from `start` looking for a project file, like git looks for `.git`."""
    current = Path(start).resolve()
    for candidate in [current, *current.parents]:
        if (candidate / PROJECT_FILENAME).is_file():
            return candidate
    return None


def _build(cls: type, data: dict[str, Any]):
    """Construct a settings dataclass from camelCase JSON, ignoring unknown keys."""
    fields = set(cls.__dataclass_fields__)  # type: ignore[attr-defined]
    kwargs = {}
    for key, value in (data or {}).items():
        snake = _snake(key)
        if snake in fields:
            kwargs[snake] = value
    return cls(**kwargs)


def _camel(data: dict[str, Any]) -> dict[str, Any]:
    """snake_case -> camelCase, so the JSON reads the same as the TypeScript types."""
    out = {}
    for key, value in data.items():
        head, *rest = key.split("_")
        out[head + "".join(p.title() for p in rest)] = value
    return out


def _snake(key: str) -> str:
    return "".join("_" + c.lower() if c.isupper() else c for c in key)


def _yaml_path(path: Path) -> str:
    """Forward slashes: a Windows backslash in YAML is an escape sequence."""
    return str(path).replace("\\", "/")

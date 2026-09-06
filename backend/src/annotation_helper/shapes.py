"""The one shape model, shared by boxes and polygons.

The predecessor had a Box tab and a Seg tab that shared nothing, which is how every
polygon it ever wrote ended up as class 0. One model makes that unrepresentable.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any, Literal, Union

from .geometry import polygon_area, polygon_bounds

ShapeSource = Literal["manual", "ai"]
"""Where a shape came from. Lets the UI render unreviewed predictions differently."""


def new_id() -> str:
    return uuid.uuid4().hex[:12]


@dataclass(slots=True)
class Box:
    """Axis-aligned box in image pixels. x1/y1 is top-left, x2/y2 bottom-right."""

    class_id: int
    x1: float
    y1: float
    x2: float
    y2: float
    source: ShapeSource = "manual"
    id: str = field(default_factory=new_id)
    kind: Literal["box"] = "box"

    def normalised(self) -> "Box":
        """Return a copy with x1<=x2 and y1<=y2, whichever way it was dragged."""
        return Box(
            class_id=self.class_id,
            x1=min(self.x1, self.x2),
            y1=min(self.y1, self.y2),
            x2=max(self.x1, self.x2),
            y2=max(self.y1, self.y2),
            source=self.source,
            id=self.id,
        )

    @property
    def width(self) -> float:
        return abs(self.x2 - self.x1)

    @property
    def height(self) -> float:
        return abs(self.y2 - self.y1)

    @property
    def area(self) -> float:
        return self.width * self.height

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": "box",
            "classId": self.class_id,
            "source": self.source,
            "x1": self.x1,
            "y1": self.y1,
            "x2": self.x2,
            "y2": self.y2,
        }


@dataclass(slots=True)
class Polygon:
    """Closed polygon in image pixels. The first point is not repeated at the end."""

    class_id: int
    points: list[tuple[float, float]]
    source: ShapeSource = "manual"
    id: str = field(default_factory=new_id)
    kind: Literal["polygon"] = "polygon"

    @property
    def area(self) -> float:
        return polygon_area(self.points)

    def bounds(self) -> tuple[float, float, float, float]:
        return polygon_bounds(self.points)

    def to_box(self) -> Box:
        x1, y1, x2, y2 = self.bounds()
        return Box(self.class_id, x1, y1, x2, y2, source=self.source)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": "polygon",
            "classId": self.class_id,
            "source": self.source,
            "points": [[x, y] for x, y in self.points],
        }


Shape = Union[Box, Polygon]


def shape_from_dict(data: dict[str, Any]) -> Shape:
    """Inverse of `to_dict`. Used by the sidecar protocol and the project scratch file."""
    kind = data.get("kind")
    source: ShapeSource = "ai" if data.get("source") == "ai" else "manual"
    shape_id = str(data.get("id") or new_id())
    class_id = int(data.get("classId", 0))

    if kind == "box":
        return Box(
            class_id=class_id,
            x1=float(data["x1"]),
            y1=float(data["y1"]),
            x2=float(data["x2"]),
            y2=float(data["y2"]),
            source=source,
            id=shape_id,
        )
    if kind == "polygon":
        return Polygon(
            class_id=class_id,
            points=[(float(x), float(y)) for x, y in data["points"]],
            source=source,
            id=shape_id,
        )
    raise ValueError(f"unknown shape kind: {kind!r}")


@dataclass(slots=True)
class ImageAnnotation:
    """Everything known about one image.

    `reviewed` is what makes negative samples expressible: `reviewed=True` with zero
    shapes means "verified background", which is training data. `reviewed=False` with
    zero shapes means "not looked at yet". An empty list alone cannot say which.
    """

    image_file: str
    width: int
    height: int
    shapes: list[Shape] = field(default_factory=list)
    reviewed: bool = False

    @property
    def is_background(self) -> bool:
        return self.reviewed and not self.shapes

    def to_dict(self) -> dict[str, Any]:
        return {
            "imageFile": self.image_file,
            "width": self.width,
            "height": self.height,
            "shapes": [s.to_dict() for s in self.shapes],
            "reviewed": self.reviewed,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ImageAnnotation":
        return cls(
            image_file=str(data["imageFile"]),
            width=int(data["width"]),
            height=int(data["height"]),
            shapes=[shape_from_dict(s) for s in data.get("shapes", [])],
            reviewed=bool(data.get("reviewed", False)),
        )

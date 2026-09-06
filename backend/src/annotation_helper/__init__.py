"""Annotation Helper - YOLO annotation engine.

Public surface kept small on purpose; the GUI and the CLI both go through these names.
"""

from .shapes import Box, ImageAnnotation, Polygon, Shape, ShapeSource
from .project import Project, ProjectClass

__version__ = "0.1.0"

__all__ = [
    "Box",
    "ImageAnnotation",
    "Polygon",
    "Shape",
    "ShapeSource",
    "Project",
    "ProjectClass",
    "__version__",
]

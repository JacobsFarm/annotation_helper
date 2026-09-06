from __future__ import annotations

import struct
import zlib
from pathlib import Path

import pytest

from annotation_helper.labels import write_labels
from annotation_helper.project import create_project
from annotation_helper.shapes import Box


def write_png(path: Path, width: int, height: int) -> Path:
    """Smallest valid PNG of a given size.

    Hand-rolled rather than via Pillow so the test suite runs in a bare interpreter,
    which is also what proves `imageinfo` reads real headers and not Pillow's output.
    """

    def chunk(tag: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + tag
            + payload
            + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
        )

    raw = b"".join(b"\x00" + b"\x00\x00\x00" * width for _ in range(height))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )
    return path


@pytest.fixture
def project(tmp_path):
    """An empty project with the standard folder layout."""
    return create_project(tmp_path / "proj", name="Test project")


@pytest.fixture
def populated(project):
    """12 images: 8 labelled with one box, 2 verified background, 2 untouched."""
    for i in range(12):
        image = write_png(project.images_dir / f"img_{i:02d}.png", 64, 48)
        if i < 8:
            write_labels(project.labels_dir / f"{image.stem}.txt", [Box(0, 8, 8, 40, 32)], 64, 48)
        elif i < 10:
            write_labels(project.labels_dir / f"{image.stem}.txt", [], 64, 48)
    return project

"""Read image dimensions from file headers, without decoding the pixels.

Scanning a 50k-image dataset must not mean decoding 50k JPEGs. These readers touch
a few hundred bytes per file. Pillow is used only as a fallback for exotic formats,
and only if it happens to be installed.
"""

from __future__ import annotations

import struct
from pathlib import Path


def image_size(path: Path) -> tuple[int, int] | None:
    """Return `(width, height)` in pixels, or None if the format is unreadable."""
    try:
        with path.open("rb") as fh:
            head = fh.read(32)
            if len(head) < 24:
                return None

            if head[:8] == b"\x89PNG\r\n\x1a\n":
                width, height = struct.unpack(">II", head[16:24])
                return int(width), int(height)

            if head[:2] == b"\xff\xd8":
                return _jpeg_size(fh)

            if head[:2] == b"BM":
                width, height = struct.unpack("<ii", head[18:26])
                return int(width), abs(int(height))

            if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
                return _webp_size(head, fh)
    except OSError:
        return None

    return _pillow_size(path)


def _jpeg_size(fh) -> tuple[int, int] | None:
    """Walk JPEG segments to the SOFn frame header that carries the dimensions."""
    fh.seek(2)
    while True:
        marker = fh.read(2)
        if len(marker) < 2 or marker[0] != 0xFF:
            return None
        code = marker[1]
        length_bytes = fh.read(2)
        if len(length_bytes) < 2:
            return None
        (length,) = struct.unpack(">H", length_bytes)
        # SOF0..SOF15, excluding the DHT/JPG/DAC markers that share the range.
        if 0xC0 <= code <= 0xCF and code not in (0xC4, 0xC8, 0xCC):
            data = fh.read(5)
            if len(data) < 5:
                return None
            height, width = struct.unpack(">HH", data[1:5])
            return int(width), int(height)
        fh.seek(length - 2, 1)


def _webp_size(head: bytes, fh) -> tuple[int, int] | None:
    chunk = head[12:16]
    if chunk == b"VP8X":
        fh.seek(24)
        data = fh.read(6)
        if len(data) < 6:
            return None
        width = 1 + int.from_bytes(data[0:3], "little")
        height = 1 + int.from_bytes(data[3:6], "little")
        return width, height
    if chunk == b"VP8 ":
        fh.seek(26)
        data = fh.read(4)
        if len(data) < 4:
            return None
        width, height = struct.unpack("<HH", data)
        return width & 0x3FFF, height & 0x3FFF
    if chunk == b"VP8L":
        fh.seek(21)
        data = fh.read(4)
        if len(data) < 4:
            return None
        bits = int.from_bytes(data, "little")
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    return None


def _pillow_size(path: Path) -> tuple[int, int] | None:
    try:
        from PIL import Image  # noqa: PLC0415 - optional, imported only on fallback
    except ImportError:
        return None
    try:
        with Image.open(path) as img:
            return img.width, img.height
    except Exception:
        return None

"""Pure geometry helpers.

Coordinates are image pixels everywhere in this package. The single conversion to
YOLO's normalised 0-1 range lives in `labels.py` and nowhere else.
"""

from __future__ import annotations


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return low if value < low else high if value > high else value


def normalise(value: float, extent: int) -> float:
    """Pixel -> 0-1. `extent` is image width or height."""
    if extent <= 0:
        raise ValueError("image extent must be positive")
    return clamp(value / extent)


def denormalise(value: float, extent: int) -> float:
    """0-1 -> pixel."""
    return value * extent


def polygon_area(points: list[tuple[float, float]]) -> float:
    """Shoelace area, always positive. Used to drop degenerate polygons."""
    if len(points) < 3:
        return 0.0
    total = 0.0
    for i, (x1, y1) in enumerate(points):
        x2, y2 = points[(i + 1) % len(points)]
        total += x1 * y2 - x2 * y1
    return abs(total) / 2.0


def polygon_bounds(points: list[tuple[float, float]]) -> tuple[float, float, float, float]:
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


def simplify(points: list[tuple[float, float]], tolerance: float) -> list[tuple[float, float]]:
    """Ramer-Douglas-Peucker. Keeps polygons editable after a model produces 400 vertices."""
    if tolerance <= 0 or len(points) < 3:
        return list(points)

    def _rdp(pts: list[tuple[float, float]]) -> list[tuple[float, float]]:
        if len(pts) < 3:
            return pts
        start, end = pts[0], pts[-1]
        index, furthest = 0, 0.0
        for i in range(1, len(pts) - 1):
            d = _perpendicular_distance(pts[i], start, end)
            if d > furthest:
                index, furthest = i, d
        if furthest <= tolerance:
            return [start, end]
        return _rdp(pts[: index + 1])[:-1] + _rdp(pts[index:])

    # Treat the polygon as closed by simplifying the open chain and keeping the first point.
    simplified = _rdp(list(points) + [points[0]])
    return simplified[:-1] if len(simplified) > 3 else list(points)


def _perpendicular_distance(
    point: tuple[float, float],
    line_start: tuple[float, float],
    line_end: tuple[float, float],
) -> float:
    (px, py), (x1, y1), (x2, y2) = point, line_start, line_end
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return ((px - x1) ** 2 + (py - y1) ** 2) ** 0.5
    return abs(dy * px - dx * py + x2 * y1 - y2 * x1) / ((dx * dx + dy * dy) ** 0.5)

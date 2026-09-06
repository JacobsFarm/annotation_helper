"""The round-trip test the blueprint calls the highest-value single test.

`Shape[] -> YOLO txt -> Shape[]` must be lossless within float tolerance, for boxes and
polygons, including coordinates that sit exactly on the image edge.
"""

from __future__ import annotations

import pytest

from annotation_helper.labels import (
    format_label_text,
    parse_label_text,
    read_labels,
    write_labels,
)
from annotation_helper.shapes import Box, ImageAnnotation, Polygon, shape_from_dict

W, H = 1920, 1080
TOLERANCE = 0.01  # one 6-decimal step is ~0.002 px at this width


def roundtrip(shapes, width=W, height=H):
    text = format_label_text(shapes, width, height)
    return parse_label_text(text, width, height)


def test_box_roundtrip_is_lossless():
    original = Box(2, 100.0, 200.0, 400.0, 650.0)
    result = roundtrip([original])

    assert not result.issues
    (restored,) = result.shapes
    assert isinstance(restored, Box)
    assert restored.class_id == 2
    for got, want in zip(
        (restored.x1, restored.y1, restored.x2, restored.y2),
        (original.x1, original.y1, original.x2, original.y2),
    ):
        assert got == pytest.approx(want, abs=TOLERANCE)


def test_box_at_image_edges_survives():
    """0 and max are where clamping bugs live."""
    result = roundtrip([Box(0, 0.0, 0.0, float(W), float(H))])
    (restored,) = result.shapes
    assert restored.x1 == pytest.approx(0.0, abs=TOLERANCE)
    assert restored.y1 == pytest.approx(0.0, abs=TOLERANCE)
    assert restored.x2 == pytest.approx(W, abs=TOLERANCE)
    assert restored.y2 == pytest.approx(H, abs=TOLERANCE)


def test_box_drawn_backwards_is_normalised_on_write():
    """Dragging bottom-right to top-left must still write a valid box."""
    result = roundtrip([Box(0, 400.0, 650.0, 100.0, 200.0)])
    (restored,) = result.shapes
    assert restored.x1 < restored.x2
    assert restored.y1 < restored.y2
    assert restored.x1 == pytest.approx(100.0, abs=TOLERANCE)


def test_polygon_roundtrip_is_lossless():
    points = [(10.0, 20.0), (500.0, 30.0), (480.0, 700.0), (60.0, 640.0)]
    result = roundtrip([Polygon(1, points)])

    assert not result.issues
    (restored,) = result.shapes
    assert isinstance(restored, Polygon)
    assert restored.class_id == 1
    assert len(restored.points) == len(points)
    for (gx, gy), (wx, wy) in zip(restored.points, points):
        assert gx == pytest.approx(wx, abs=TOLERANCE)
        assert gy == pytest.approx(wy, abs=TOLERANCE)


def test_boxes_and_polygons_coexist_in_one_file():
    shapes = [Box(0, 10.0, 10.0, 100.0, 100.0), Polygon(3, [(5.0, 5.0), (50.0, 8.0), (30.0, 60.0)])]
    result = roundtrip(shapes)
    assert [type(s).__name__ for s in result.shapes] == ["Box", "Polygon"]
    assert result.shapes[1].class_id == 3


def test_polygon_class_id_is_preserved():
    """The predecessor wrote every polygon as class 0. Guard against the regression."""
    text = format_label_text([Polygon(7, [(1.0, 1.0), (20.0, 2.0), (10.0, 30.0)])], W, H)
    assert text.split()[0] == "7"


def test_writing_twice_produces_identical_files():
    shapes = [Box(0, 12.5, 33.25, 400.0, 500.75)]
    first = format_label_text(shapes, W, H)
    second = format_label_text(parse_label_text(first, W, H).shapes, W, H)
    assert first == second


# --- malformed input --------------------------------------------------------


def test_malformed_row_is_reported_not_raised():
    result = parse_label_text("0 0.5 0.5 0.2 0.2\nthis is not a label\n", W, H)
    assert len(result.shapes) == 1
    assert [i.code for i in result.issues] == ["malformed_row"]
    assert result.issues[0].line == 2


def test_out_of_range_coordinates_are_flagged_but_kept():
    """Flag it, keep the shape: throwing the data away is worse than warning about it."""
    result = parse_label_text("0 0.5 0.5 1.4 0.2\n", W, H)
    assert len(result.shapes) == 1
    assert any(i.code == "coordinate_out_of_range" for i in result.issues)


def test_odd_token_count_is_rejected():
    result = parse_label_text("0 0.1 0.2 0.3\n", W, H)
    assert not result.shapes
    assert result.issues[0].code == "unexpected_token_count"


def test_blank_lines_and_comments_are_ignored():
    result = parse_label_text("\n# a note\n0 0.5 0.5 0.2 0.2\n\n", W, H)
    assert len(result.shapes) == 1
    assert not result.issues


# --- negative samples -------------------------------------------------------


def test_missing_file_is_not_the_same_as_empty_file(tmp_path):
    image = tmp_path / "a.jpg"
    label = tmp_path / "a.txt"

    missing = read_labels(label, W, H)
    assert missing.existed is False
    assert missing.is_background is False

    write_labels(label, [], W, H)
    empty = read_labels(label, W, H)
    assert empty.existed is True
    assert empty.is_background is True
    assert label.read_text() == ""
    assert not image.exists()  # writing a label must not touch the image


def test_annotation_distinguishes_background_from_untouched():
    untouched = ImageAnnotation("a.jpg", W, H, [], reviewed=False)
    background = ImageAnnotation("b.jpg", W, H, [], reviewed=True)
    assert untouched.is_background is False
    assert background.is_background is True


# --- serialisation for the sidecar / scratch file ---------------------------


def test_shape_dict_roundtrip():
    for shape in (Box(1, 1.0, 2.0, 3.0, 4.0, source="ai"), Polygon(2, [(0.0, 0.0), (1.0, 0.0), (0.0, 1.0)])):
        restored = shape_from_dict(shape.to_dict())
        assert restored.to_dict() == shape.to_dict()


def test_shape_source_survives_the_wire():
    restored = shape_from_dict(Box(0, 0.0, 0.0, 1.0, 1.0, source="ai").to_dict())
    assert restored.source == "ai"

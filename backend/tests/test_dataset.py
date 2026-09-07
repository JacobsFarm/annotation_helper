from __future__ import annotations

import pytest

from annotation_helper.dataset import (
    health_check,
    iter_images,
    load_index,
    refresh_index,
    split_dataset,
)
from annotation_helper.imageinfo import image_size

from conftest import write_png


def test_scan_finds_images_in_sorted_order(populated):
    names = [p.name for p in iter_images(populated.images_dir)]
    assert names == sorted(names)
    assert len(names) == 12


def test_image_size_reads_the_header_without_pillow(tmp_path):
    path = write_png(tmp_path / "x.png", 137, 91)
    assert image_size(path) == (137, 91)


def test_index_is_written_and_reused(populated):
    entries = refresh_index(populated)
    assert len(entries) == 12
    assert sum(1 for e in entries if e.labelled) == 10  # 8 boxed + 2 background

    cached = load_index(populated)
    assert len(cached) == 12
    assert cached["img_00.png"].shape_count == 1


def test_index_survives_a_corrupt_cache(populated):
    refresh_index(populated)
    (populated.state_dir / "index.json").write_text("{not json", encoding="utf-8")
    assert load_index(populated) == {}  # a bad cache is a miss, never an error


def test_health_check_counts_and_finds_gaps(populated):
    report = health_check(populated)

    assert report.images == 12
    assert report.labelled == 10
    assert report.unlabelled == 2
    assert report.backgrounds == 2
    assert report.shapes == 8
    assert report.per_class == {0: 8}
    assert sum(1 for i in report.issues if i.code == "missing_label") == 2
    assert report.errors == 0


def test_health_check_flags_unknown_class_ids(populated):
    (populated.labels_dir / "img_00.txt").write_text("9 0.5 0.5 0.2 0.2\n", encoding="utf-8")
    report = health_check(populated)
    assert any(i.code == "unknown_class_id" and i.detail == "9" for i in report.issues)
    assert report.errors >= 1


def test_health_check_flags_orphan_labels(populated):
    (populated.labels_dir / "ghost.txt").write_text("0 0.5 0.5 0.1 0.1\n", encoding="utf-8")
    report = health_check(populated)
    assert any(i.code == "orphan_label" and i.file == "ghost.txt" for i in report.issues)


def test_split_partitions_every_labelled_image(populated):
    result = split_dataset(populated, mode="copy")

    assert result.train + result.val + result.test == 10
    assert result.skipped == 2  # the unlabelled ones
    for name in ("train", "val", "test"):
        assert (populated.output_dir / name / "images").is_dir()

    copied = list((populated.output_dir / "train" / "images").glob("*.png"))
    assert len(copied) == result.train
    assert len(list(populated.images_dir.glob("*.png"))) == 12  # copy leaves the source alone


def test_split_is_reproducible_for_a_seed(populated):
    first = split_dataset(populated, output=populated.root / "a", mode="lists")
    second = split_dataset(populated, output=populated.root / "b", mode="lists")
    assert (populated.root / "a" / "train.txt").read_text() == (
        populated.root / "b" / "train.txt"
    ).read_text()
    assert first.to_dict()["train"] == second.to_dict()["train"]


def test_split_lists_mode_touches_no_image(populated):
    split_dataset(populated, mode="lists")
    assert not (populated.output_dir / "train" / "images").exists()
    listing = (populated.output_dir / "train.txt").read_text().splitlines()
    assert all(line.endswith(".png") for line in listing)


def test_split_writes_data_yaml(populated):
    split_dataset(populated, mode="lists")
    yaml = (populated.root / "data.yaml").read_text()
    assert "train: train/images" in yaml
    assert "nc: 1" in yaml
    assert "\\" not in yaml  # forward slashes only; a backslash is a YAML escape


def test_split_with_include_unlabelled_takes_everything(populated):
    result = split_dataset(populated, mode="lists", include_unlabelled=True)
    assert result.train + result.val + result.test == 12
    assert result.skipped == 0


def test_split_apportions_by_largest_remainder(populated):
    """Flooring alone would give train 4 / val 0 / test 2 for ten images at 80/15/5."""
    result = split_dataset(populated, mode="lists")
    assert (result.train, result.val, result.test) == (8, 2, 0)


def test_split_with_no_test_ratio_gives_test_nothing(populated):
    populated.split.test = 0.0
    populated.split.train = 0.75
    populated.split.val = 0.25
    result = split_dataset(populated, mode="lists")
    assert result.test == 0
    assert result.train + result.val == 10


# --- boxes and polygons kept apart ------------------------------------------


def test_index_counts_each_shape_kind(kinds):
    entries = {e.file: e for e in refresh_index(kinds)}

    assert entries["img_00.png"].kind == "polygon"
    assert entries["img_04.png"].kind == "box"
    assert entries["img_07.png"].kind == "mixed"
    assert (entries["img_07.png"].box_count, entries["img_07.png"].polygon_count) == (1, 1)
    assert entries["img_09.png"].kind == "background"
    assert entries["img_10.png"].kind == "none"  # no label file: not looked at yet


def test_index_counts_survive_the_cache(kinds):
    refresh_index(kinds)
    cached = load_index(kinds)
    assert cached["img_00.png"].polygon_count == 1
    assert cached["img_04.png"].box_count == 1


def test_health_check_tallies_images_per_kind(kinds):
    report = health_check(kinds)
    assert report.per_kind == {"polygon": 4, "box": 3, "mixed": 2, "background": 1}
    assert (report.boxes, report.polygons) == (5, 6)


def test_mixed_file_is_only_a_warning_for_a_detection_project(kinds):
    report = health_check(kinds)  # the fixture's task is "detect"
    mixed = [i for i in report.issues if i.code == "mixed_shape_kinds"]
    assert len(mixed) == 2
    assert {i.level for i in mixed} == {"warning"}
    assert report.errors == 0
    assert not any(i.code == "box_only_image" for i in report.issues)


def test_mixed_file_is_an_error_for_a_segmentation_project(kinds):
    """One box row among polygons is read as a two-point polygon and becomes nonsense."""
    kinds.task = "segment"
    report = health_check(kinds)

    assert [i.level for i in report.issues if i.code == "mixed_shape_kinds"] == ["error"] * 2
    assert report.errors == 2
    assert sum(1 for i in report.issues if i.code == "box_only_image") == 3


def test_split_for_segmentation_leaves_out_what_has_no_mask(kinds):
    result = split_dataset(kinds, mode="lists", shapes="segment")

    assert result.train + result.val + result.test == 5  # 4 polygon + 1 background
    assert result.skipped_kind == 5  # 3 box-only + 2 mixed
    assert result.skipped == 2  # the unlabelled ones, as always

    listed = "".join(
        (kinds.output_dir / f"{name}.txt").read_text() for name in ("train", "val", "test")
    )
    for boxed in ("img_04", "img_05", "img_06", "img_07", "img_08"):
        assert boxed not in listed


def test_split_for_detection_flattens_every_polygon(kinds):
    result = split_dataset(kinds, mode="copy", shapes="detect")

    assert result.train + result.val + result.test == 10  # nothing is excluded
    assert result.skipped_kind == 0
    assert result.converted == 6  # 4 polygon-only + 2 mixed

    for split in ("train", "val", "test"):
        for label in (kinds.output_dir / split / "labels").glob("*.txt"):
            for line in label.read_text().splitlines():
                assert len(line.split()) == 5, f"{label.name}: {line}"


def test_split_for_detection_never_touches_the_source_labels(kinds):
    split_dataset(kinds, mode="copy", shapes="detect")
    original = (kinds.labels_dir / "img_00.txt").read_text().split()
    assert len(original) == 7  # still a polygon where the work was done


def test_split_for_detection_refuses_lists_mode(kinds):
    """Lists mode copies nothing, so there is no file to write the conversion into."""
    with pytest.raises(ValueError, match="lists"):
        split_dataset(kinds, mode="lists", shapes="detect")


def test_split_without_a_selection_is_unchanged(kinds):
    result = split_dataset(kinds, mode="lists")
    assert result.train + result.val + result.test == 10
    assert (result.skipped_kind, result.converted) == (0, 0)

from __future__ import annotations

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

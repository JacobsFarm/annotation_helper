from __future__ import annotations

import json

from annotation_helper.project import (
    PROJECT_FILENAME,
    Project,
    ProjectClass,
    create_project,
    find_project,
)


def test_create_lays_out_the_standard_folders(tmp_path):
    project = create_project(tmp_path / "p", name="Demo")
    assert project.file.is_file()
    assert project.input_dir.is_dir()  # the inbox, where images land before annotating
    assert project.images_dir.is_dir()
    assert project.labels_dir.is_dir()
    assert project.recycle_dir.is_dir()  # the bin, so a delete always has somewhere to go
    assert (project.root / "classes.txt").read_text().strip() == "object"


def test_paths_round_trip_through_the_file(tmp_path):
    """The inbox is a project setting, so it must survive a save/load like the rest."""
    project = create_project(tmp_path / "p")
    project.paths.input = "inbox"
    project.save()

    reloaded = Project.load(project.file)
    assert reloaded.paths.input == "inbox"
    assert reloaded.input_dir == project.root / "inbox"


def test_the_bin_is_a_visible_folder_not_application_state(tmp_path):
    """It holds the user's own files, so deleting `.annotation-helper/` must not take it."""
    project = create_project(tmp_path / "p")
    assert project.recycle_dir == project.root / "recycle"
    assert project.state_dir not in project.recycle_dir.parents
    assert project.trash_dir == project.recycle_dir  # the old name still resolves


def test_create_is_idempotent_and_keeps_edits(tmp_path):
    first = create_project(tmp_path / "p")
    first.classes = [ProjectClass(0, "leaf"), ProjectClass(1, "stem")]
    first.save()

    second = create_project(tmp_path / "p")
    assert [c.name for c in second.classes] == ["leaf", "stem"]


def test_saved_json_is_camel_case_and_readable(tmp_path):
    project = create_project(tmp_path / "p")
    data = json.loads(project.file.read_text())
    assert data["formatVersion"] == 1
    assert "confidence" in data["ai"]
    assert "expandRatio" in data["ai"]  # snake_case must not leak into the file
    assert data["paths"]["images"] == "images"  # relative, so the folder stays portable


def test_load_accepts_folder_or_file(tmp_path):
    created = create_project(tmp_path / "p")
    assert Project.load(tmp_path / "p").name == created.name
    assert Project.load(tmp_path / "p" / PROJECT_FILENAME).name == created.name


def test_unknown_keys_in_the_file_are_ignored(tmp_path):
    project = create_project(tmp_path / "p")
    data = json.loads(project.file.read_text())
    data["ai"]["somethingFromTheFuture"] = 42
    project.file.write_text(json.dumps(data), encoding="utf-8")

    reloaded = Project.load(project.file)  # must not raise
    assert reloaded.ai.confidence == 0.25


def test_class_names_fill_gaps_because_yolo_indexes_by_position(tmp_path):
    project = create_project(tmp_path / "p")
    project.classes = [ProjectClass(0, "a"), ProjectClass(2, "c")]
    assert project.class_names() == ["a", "class_1", "c"]


def test_find_project_walks_upwards(tmp_path):
    project = create_project(tmp_path / "p")
    nested = project.images_dir / "sub" / "deeper"
    nested.mkdir(parents=True)
    assert find_project(nested) == project.root.resolve()
    assert find_project(tmp_path) is None


def test_data_yaml_lists_test_split_only_when_requested(tmp_path):
    project = create_project(tmp_path / "p")
    assert "test: test/images" in project.write_data_yaml().read_text()

    project.split.test = 0.0
    assert "test: test/images" not in project.write_data_yaml().read_text()

"""Nothing is ever hard-deleted, and every destructive step is reversible."""

from __future__ import annotations

from annotation_helper.fileops import FileJournal, copy, move, trash, undo_last, unique_target


def make(path, text="x"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def test_unique_target_never_overwrites(tmp_path):
    make(tmp_path / "a.jpg")
    assert unique_target(tmp_path / "a.jpg").name == "a (2).jpg"
    make(tmp_path / "a (2).jpg")
    assert unique_target(tmp_path / "a.jpg").name == "a (3).jpg"


def test_move_is_journalled_and_undoable(tmp_path):
    journal = FileJournal(tmp_path / "journal.ndjson")
    source = make(tmp_path / "src" / "a.jpg", "content")
    target = move(source, tmp_path / "dst", journal)

    assert target.is_file() and not source.exists()
    assert len(journal.entries()) == 1

    undo_last(journal)
    assert source.is_file() and source.read_text() == "content"
    assert not target.exists()
    assert journal.entries() == []


def test_trash_keeps_the_file(tmp_path):
    journal = FileJournal(tmp_path / "journal.ndjson")
    source = make(tmp_path / "a.jpg")
    binned = trash(source, tmp_path / ".trash", journal)

    assert binned.is_file()  # "delete" means recoverable
    assert binned.parent.name == ".trash"

    undo_last(journal)
    assert source.is_file()


def test_undo_of_a_copy_removes_the_duplicate(tmp_path):
    journal = FileJournal(tmp_path / "journal.ndjson")
    source = make(tmp_path / "a.jpg")
    duplicate = copy(source, tmp_path / "dst", journal)

    undo_last(journal)
    assert source.is_file()
    assert not duplicate.exists()


def test_undo_replays_backwards(tmp_path):
    journal = FileJournal(tmp_path / "journal.ndjson")
    first = make(tmp_path / "src" / "a.jpg")
    second = make(tmp_path / "src" / "b.jpg")
    move(first, tmp_path / "dst", journal)
    move(second, tmp_path / "dst", journal)

    undone = undo_last(journal)
    assert undone is not None and undone.source.endswith("b.jpg")
    assert second.is_file()
    assert not first.exists()  # only the newest operation was reversed


def test_undo_on_an_empty_journal_is_a_no_op(tmp_path):
    assert undo_last(FileJournal(tmp_path / "journal.ndjson")) is None


def test_a_truncated_journal_line_is_skipped(tmp_path):
    path = tmp_path / "journal.ndjson"
    path.write_text('{"op":"move","source":"a","target":"b","timestamp":1}\n{"op":"mo',
                    encoding="utf-8")
    assert len(FileJournal(path).entries()) == 1

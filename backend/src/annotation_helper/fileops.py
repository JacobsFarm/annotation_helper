"""Journalled file operations. Nothing is ever hard-deleted.

The predecessor deleted an image and its label permanently, with no confirmation and
no recovery, and wrapped the move in a bare `except: pass` so failures were silent.
Both are fixed here by construction:

* every move / copy / delete goes through this module,
* each one appends a record to a session journal,
* `undo_last` replays the journal backwards,
* `delete` means "move into the project trash folder".
"""

from __future__ import annotations

import json
import shutil
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Literal

OpKind = Literal["move", "copy", "trash", "write"]


@dataclass(slots=True)
class JournalEntry:
    op: OpKind
    source: str
    target: str
    timestamp: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class FileJournal:
    """Append-only NDJSON log of every destructive operation in a project.

    NDJSON rather than a JSON array: appending is one line and a truncated file still
    parses up to the last complete record.
    """

    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def append(self, entry: JournalEntry) -> None:
        with self.path.open("a", encoding="utf-8", newline="\n") as fh:
            fh.write(json.dumps(entry.to_dict()) + "\n")

    def entries(self) -> list[JournalEntry]:
        if not self.path.is_file():
            return []
        out: list[JournalEntry] = []
        for line in self.path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
                out.append(
                    JournalEntry(
                        op=data["op"],
                        source=data["source"],
                        target=data["target"],
                        timestamp=float(data.get("timestamp", 0.0)),
                    )
                )
            except (json.JSONDecodeError, KeyError):
                continue  # a partially written last line is expected after a crash
        return out

    def pop(self) -> JournalEntry | None:
        """Remove and return the newest entry. Rewrites the file; it stays small."""
        records = self.entries()
        if not records:
            return None
        last = records.pop()
        body = "".join(json.dumps(e.to_dict()) + "\n" for e in records)
        self.path.write_text(body, encoding="utf-8", newline="\n")
        return last


def unique_target(target: Path) -> Path:
    """`name.jpg` -> `name (2).jpg` when the target is taken. Never overwrites blindly."""
    if not target.exists():
        return target
    stem, suffix, parent = target.stem, target.suffix, target.parent
    counter = 2
    while True:
        candidate = parent / f"{stem} ({counter}){suffix}"
        if not candidate.exists():
            return candidate
        counter += 1


def move(source: Path, target_dir: Path, journal: FileJournal | None = None) -> Path:
    target_dir.mkdir(parents=True, exist_ok=True)
    target = unique_target(target_dir / source.name)
    shutil.move(str(source), str(target))
    if journal:
        journal.append(JournalEntry("move", str(source), str(target), time.time()))
    return target


def copy(source: Path, target_dir: Path, journal: FileJournal | None = None) -> Path:
    target_dir.mkdir(parents=True, exist_ok=True)
    target = unique_target(target_dir / source.name)
    shutil.copy2(str(source), str(target))
    if journal:
        journal.append(JournalEntry("copy", str(source), str(target), time.time()))
    return target


def trash(source: Path, trash_dir: Path, journal: FileJournal | None = None) -> Path:
    """The only "delete" in this codebase. Recoverable until the user empties it."""
    trash_dir.mkdir(parents=True, exist_ok=True)
    target = unique_target(trash_dir / source.name)
    shutil.move(str(source), str(target))
    if journal:
        journal.append(JournalEntry("trash", str(source), str(target), time.time()))
    return target


def undo_last(journal: FileJournal) -> JournalEntry | None:
    """Reverse the newest journalled operation.

    A move or trash goes back where it came from; a copy is removed again. Returns the
    entry that was undone, or None if there was nothing to undo.
    """
    entry = journal.pop()
    if entry is None:
        return None

    source, target = Path(entry.source), Path(entry.target)
    if entry.op in ("move", "trash"):
        if target.exists():
            source.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(target), str(source))
    elif entry.op == "copy":
        if target.exists():
            target.unlink()
    return entry

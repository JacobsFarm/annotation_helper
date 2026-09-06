"""Launch and supervise an ultralytics training run.

Training runs in its own subprocess rather than inside the sidecar. Three reasons:

* a torch process that hangs or OOMs must not take the sidecar (and prediction) down,
* cancelling means killing a process, which always works, unlike cooperative flags,
* the exact command is printable, so a user can copy it and run it in their own shell.

The last point matters most: the GUI must never be the only way to start a run.
"""

from __future__ import annotations

import os
import re
import signal
import subprocess
import sys
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from ..project import Project

EventFn = Callable[[str, dict[str, Any]], None]

# ultralytics prints "      1/100      2.31G ..." per epoch; enough to drive a progress bar.
EPOCH_PATTERN = re.compile(r"^\s*(\d+)/(\d+)\s")


@dataclass(slots=True)
class TrainRun:
    id: str
    command: list[str]
    cwd: str
    started: float = field(default_factory=time.time)
    process: subprocess.Popen | None = None
    epochs: int = 0
    epoch: int = 0
    finished: bool = False
    exit_code: int | None = None
    lines: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "command": self.command,
            "cwd": self.cwd,
            "started": self.started,
            "epoch": self.epoch,
            "epochs": self.epochs,
            "finished": self.finished,
            "exitCode": self.exit_code,
            "running": self.process is not None and self.process.poll() is None,
        }


def build_command(project: Project, overrides: dict[str, Any] | None = None) -> list[str]:
    """The exact `yolo` invocation, as an argv list.

    Built through the ultralytics CLI rather than its Python API so the command can be
    shown to the user verbatim and pasted into a terminal.
    """
    settings = project.training
    overrides = overrides or {}
    data_yaml = Path(overrides.get("data") or (project.root / "data.yaml"))
    task = "segment" if project.task in ("segment", "both") else "detect"

    args = {
        "task": task,
        "mode": "train",
        "model": overrides.get("model", settings.model),
        "data": str(data_yaml),
        "epochs": overrides.get("epochs", settings.epochs),
        "imgsz": overrides.get("imgsz", settings.imgsz),
        "batch": overrides.get("batch", settings.batch),
        "patience": overrides.get("patience", settings.patience),
        "project": str(project.root / "runs"),
        "name": overrides.get("runName", settings.run_name),
        "exist_ok": "True",
    }
    device = overrides.get("device", settings.device)
    if device:
        args["device"] = device

    return [sys.executable, "-m", "ultralytics.cfg", *[f"{k}={v}" for k, v in args.items()]]


class TrainingManager:
    """Owns at most one run per id and streams its output as events."""

    def __init__(self) -> None:
        self._runs: dict[str, TrainRun] = {}
        self._lock = threading.Lock()

    def start(
        self,
        project: Project,
        overrides: dict[str, Any] | None = None,
        emit: EventFn | None = None,
    ) -> TrainRun:
        command = build_command(project, overrides)
        run = TrainRun(
            id=uuid.uuid4().hex[:8],
            command=command,
            cwd=str(project.root),
            epochs=int((overrides or {}).get("epochs", project.training.epochs)),
        )

        # New process group so a cancel can take the whole torch subtree down with it.
        creation_flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
        run.process = subprocess.Popen(
            command,
            cwd=run.cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            creationflags=creation_flags,
        )

        with self._lock:
            self._runs[run.id] = run

        thread = threading.Thread(target=self._pump, args=(run, emit), daemon=True)
        thread.start()
        return run

    def _pump(self, run: TrainRun, emit: EventFn | None) -> None:
        assert run.process is not None and run.process.stdout is not None
        for raw in run.process.stdout:
            line = raw.rstrip()
            run.lines.append(line)
            if len(run.lines) > 500:  # keep the tail; a full run prints tens of thousands
                del run.lines[:100]

            match = EPOCH_PATTERN.match(line)
            if match:
                run.epoch = int(match.group(1))
                run.epochs = int(match.group(2))

            if emit:
                emit(
                    "train_output",
                    {
                        "runId": run.id,
                        "line": line,
                        "epoch": run.epoch,
                        "epochs": run.epochs,
                    },
                )

        run.exit_code = run.process.wait()
        run.finished = True
        if emit:
            emit("train_done", {"runId": run.id, "exitCode": run.exit_code})

    def get(self, run_id: str) -> TrainRun | None:
        with self._lock:
            return self._runs.get(run_id)

    def list(self) -> list[TrainRun]:
        with self._lock:
            return list(self._runs.values())

    def cancel(self, run_id: str) -> bool:
        run = self.get(run_id)
        if run is None or run.process is None or run.process.poll() is not None:
            return False
        if os.name == "nt":
            run.process.send_signal(signal.CTRL_BREAK_EVENT)
        else:
            run.process.terminate()
        try:
            run.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            run.process.kill()
        return True

    def cancel_all(self) -> None:
        for run in self.list():
            self.cancel(run.id)

"""The NDJSON request loop.

Handlers are five lines each: unwrap params, call a service, return plain data. All the
logic lives in the modules they call, so every one of them is testable without ever
starting this loop - the same rule the Electron side follows for its IPC handlers.
"""

from __future__ import annotations

import json
import sys
import threading
from pathlib import Path
from typing import Any, Callable

from .. import __version__
from ..dataset import health_check, refresh_index, split_dataset
from ..project import Project
from ..training.runner import TrainingManager
from . import predictor
from .protocol import PROTOCOL_VERSION, ErrorCode, ProtocolError, Request, event, failure, success

Handler = Callable[["Server", Request], Any]

_HANDLERS: dict[str, Handler] = {}


def method(name: str) -> Callable[[Handler], Handler]:
    def register(fn: Handler) -> Handler:
        _HANDLERS[name] = fn
        return fn

    return register


class Server:
    def __init__(self, stdin=None, stdout=None) -> None:
        self.stdin = stdin or sys.stdin
        self.stdout = stdout or sys.stdout
        self.training = TrainingManager()
        self.cancelled: set[str] = set()
        self.running = True
        self._write_lock = threading.Lock()

    # --- transport ----------------------------------------------------------

    def send(self, frame: str) -> None:
        """One frame per line, flushed. A background thread may call this too."""
        with self._write_lock:
            self.stdout.write(frame + "\n")
            self.stdout.flush()

    def emit(self, name: str, request_id: str = "", **fields: Any) -> None:
        self.send(event(name, request_id, **fields))

    def serve_forever(self) -> int:
        self.emit("ready", version=__version__, protocol=PROTOCOL_VERSION)
        for line in self.stdin:
            line = line.strip()
            if not line:
                continue
            self.handle_line(line)
            if not self.running:
                break
        self.training.cancel_all()
        return 0

    def handle_line(self, line: str) -> None:
        """Parse, dispatch, reply. This function must never raise."""
        try:
            request = Request.parse(line)
        except (json.JSONDecodeError, ValueError) as exc:
            self.send(failure("", ErrorCode.BAD_REQUEST, "could not parse frame", str(exc)))
            return

        handler = _HANDLERS.get(request.method)
        if handler is None:
            self.send(
                failure(request.id, ErrorCode.UNKNOWN_METHOD, "unknown method", request.method)
            )
            return

        try:
            result = handler(self, request)
            self.send(success(request.id, result))
        except ProtocolError as exc:
            self.send(failure(request.id, exc.code, exc.message, exc.detail))
        except Exception as exc:  # a handler bug must not kill the sidecar
            self.send(failure(request.id, ErrorCode.INTERNAL, type(exc).__name__, str(exc)))
        finally:
            self.cancelled.discard(request.id)

    # --- shared helpers -----------------------------------------------------

    def project(self, request: Request) -> Project:
        root = request.params.get("project")
        if not root:
            raise ProtocolError(ErrorCode.PROJECT_NOT_FOUND, "no project path given")
        try:
            return Project.load(Path(root))
        except FileNotFoundError as exc:
            raise ProtocolError(ErrorCode.PROJECT_NOT_FOUND, "project not found", str(root)) from exc


# --- handlers ---------------------------------------------------------------


@method("ping")
def _ping(server: Server, request: Request) -> dict[str, Any]:
    return {
        "version": __version__,
        "protocol": PROTOCOL_VERSION,
        "python": sys.version.split()[0],
        "executable": sys.executable,
    }


@method("capabilities")
def _capabilities(server: Server, request: Request) -> dict[str, Any]:
    """What this interpreter can actually do, so the UI can say so instead of failing.

    Imports are attempted here and nowhere else at startup; probing costs a second the
    first time and turns "nothing happens when I press Predict" into a real message.
    """
    caps = {"predict": False, "train": False, "cuda": False, "pillow": False, "devices": []}
    try:
        import ultralytics  # noqa: F401, PLC0415

        caps["predict"] = True
        caps["train"] = True
    except ImportError:
        pass
    try:
        from PIL import Image  # noqa: F401, PLC0415

        caps["pillow"] = True
    except ImportError:
        pass
    try:
        import torch  # noqa: PLC0415

        caps["cuda"] = bool(torch.cuda.is_available())
        caps["devices"] = [torch.cuda.get_device_name(i) for i in range(torch.cuda.device_count())]
    except Exception:
        pass
    return caps


@method("predict")
def _predict(server: Server, request: Request) -> dict[str, Any]:
    options = predictor.PredictOptions.from_params(request.params)
    image = str(request.params.get("image", ""))

    def progress(stage: str, pct: int) -> None:
        if request.id in server.cancelled:
            raise ProtocolError(ErrorCode.CANCELLED, "cancelled by client")
        server.emit("progress", request.id, stage=stage, pct=pct)

    return predictor.predict(image, options, progress)


@method("segment.point")
def _segment_point(server: Server, request: Request) -> dict[str, Any]:
    """Interactive segmentation: clicks in, one polygon out. No progress events - the
    embedding is cached per image, so every click after the first is too fast to report
    on, and a progress bar that flashes is worse than none."""
    params = request.params
    raw_points = params.get("points") or []
    if not isinstance(raw_points, list):
        raise ProtocolError(ErrorCode.BAD_REQUEST, "'points' must be a list")
    try:
        points = [(float(p[0]), float(p[1])) for p in raw_points]
        labels = [int(label) for label in (params.get("labels") or [])]
    except (TypeError, ValueError, IndexError) as exc:
        raise ProtocolError(ErrorCode.BAD_REQUEST, "malformed points or labels", str(exc)) from exc

    return predictor.segment_at(
        image=str(params.get("image", "")),
        points=points,
        labels=labels,
        model=str(params.get("model", "")),
        simplify_tolerance=float(params.get("simplifyTolerance", 1.5)),
        class_id=int(params.get("classId", 0)),
    )


@method("cancel")
def _cancel(server: Server, request: Request) -> dict[str, Any]:
    """Cooperative cancel: the target request notices at its next progress checkpoint."""
    target = str(request.params.get("target", ""))
    server.cancelled.add(target)
    return {"cancelled": target}


@method("models.unload")
def _unload(server: Server, request: Request) -> dict[str, Any]:
    return {"unloaded": predictor.unload_models()}


@method("dataset.scan")
def _scan(server: Server, request: Request) -> dict[str, Any]:
    project = server.project(request)
    entries = refresh_index(project)
    return {"count": len(entries), "entries": [e.to_dict() for e in entries]}


@method("dataset.check")
def _check(server: Server, request: Request) -> dict[str, Any]:
    return health_check(server.project(request)).to_dict()


@method("dataset.split")
def _split(server: Server, request: Request) -> dict[str, Any]:
    project = server.project(request)
    result = split_dataset(
        project,
        output=Path(request.params["output"]) if request.params.get("output") else None,
        mode=request.params.get("mode", "copy"),
        include_unlabelled=bool(request.params.get("includeUnlabelled", False)),
    )
    return result.to_dict()


@method("train.command")
def _train_command(server: Server, request: Request) -> dict[str, Any]:
    """Return the command without running it, so the UI can show it before you commit."""
    from ..training.runner import build_command  # noqa: PLC0415 - avoids an import cycle

    project = server.project(request)
    return {"command": build_command(project, request.params.get("overrides"))}


@method("train.start")
def _train_start(server: Server, request: Request) -> dict[str, Any]:
    project = server.project(request)
    run = server.training.start(
        project,
        overrides=request.params.get("overrides"),
        emit=lambda name, fields: server.emit(name, request.id, **fields),
    )
    return run.to_dict()


@method("train.status")
def _train_status(server: Server, request: Request) -> dict[str, Any]:
    run_id = str(request.params.get("runId", ""))
    if run_id:
        run = server.training.get(run_id)
        if run is None:
            raise ProtocolError(ErrorCode.TRAINING_FAILED, "unknown run", run_id)
        return {**run.to_dict(), "tail": run.lines[-50:]}
    return {"runs": [r.to_dict() for r in server.training.list()]}


@method("train.cancel")
def _train_cancel(server: Server, request: Request) -> dict[str, Any]:
    return {"cancelled": server.training.cancel(str(request.params.get("runId", "")))}


@method("shutdown")
def _shutdown(server: Server, request: Request) -> dict[str, Any]:
    server.running = False
    return {"bye": True}


def main() -> int:
    # Reconfigure for UTF-8: a Windows console defaults to cp1252 and would mangle
    # any non-ASCII path in a frame.
    for stream in (sys.stdin, sys.stdout):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", newline="\n")
    return Server().serve_forever()


if __name__ == "__main__":
    raise SystemExit(main())

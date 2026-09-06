"""The wire format between Electron and Python.

Newline-delimited JSON over stdin/stdout. Deliberately not HTTP: there is no port to
collide with, no localhost surface to secure, and the process dies with its parent.

    -->  {"id":"7","method":"predict","params":{"image":"C:/x.jpg","pipeline":"detect"}}
    <--  {"event":"progress","id":"7","stage":"detect","pct":40}
    <--  {"id":"7","ok":true,"result":{"shapes":[...],"ms":312}}

Two invariants the whole design leans on:

1. A reply is `{ok:true,result}` or `{ok:false,error}`. It is never a raw exception and
   the loop never dies because a handler threw.
2. stdout carries protocol frames only. Anything human-readable goes to stderr, or a
   stray `print()` silently corrupts the stream.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

PROTOCOL_VERSION = 1


class ErrorCode:
    """Codes, not sentences. The renderer owns the wording and the locale."""

    BAD_REQUEST = "bad_request"
    UNKNOWN_METHOD = "unknown_method"
    MISSING_DEPENDENCY = "missing_dependency"
    MODEL_NOT_FOUND = "model_not_found"
    MODEL_LOAD_FAILED = "model_load_failed"
    IMAGE_NOT_FOUND = "image_not_found"
    PREDICT_FAILED = "predict_failed"
    PROJECT_NOT_FOUND = "project_not_found"
    TRAINING_FAILED = "training_failed"
    CANCELLED = "cancelled"
    INTERNAL = "internal"


@dataclass(slots=True)
class Request:
    id: str
    method: str
    params: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def parse(cls, line: str) -> "Request":
        data = json.loads(line)
        if not isinstance(data, dict) or "method" not in data:
            raise ValueError("frame must be an object with a 'method'")
        params = data.get("params") or {}
        if not isinstance(params, dict):
            raise ValueError("'params' must be an object")
        return cls(id=str(data.get("id", "")), method=str(data["method"]), params=params)


class ProtocolError(Exception):
    """Raised by handlers. Carries a code the UI can translate."""

    def __init__(self, code: str, message: str, detail: str = "") -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail


def success(request_id: str, result: Any) -> str:
    return json.dumps({"id": request_id, "ok": True, "result": result}, ensure_ascii=False)


def failure(request_id: str, code: str, message: str, detail: str = "") -> str:
    return json.dumps(
        {
            "id": request_id,
            "ok": False,
            "error": {"code": code, "message": message, "detail": detail},
        },
        ensure_ascii=False,
    )


def event(name: str, request_id: str = "", **fields: Any) -> str:
    return json.dumps({"event": name, "id": request_id, **fields}, ensure_ascii=False)

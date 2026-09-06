"""The sidecar loop must never die and must never reply with anything but the envelope."""

from __future__ import annotations

import io
import json

from annotation_helper.sidecar.protocol import ErrorCode, ProtocolError, Request
from annotation_helper.sidecar.server import Server, method


def run(frames: list[dict], server: Server | None = None) -> list[dict]:
    out = io.StringIO()
    server = server or Server(stdin=io.StringIO(), stdout=out)
    server.stdout = out
    for frame in frames:
        server.handle_line(json.dumps(frame))
    return [json.loads(line) for line in out.getvalue().splitlines()]


def test_ping_reports_version_and_interpreter():
    (reply,) = run([{"id": "1", "method": "ping"}])
    assert reply["ok"] is True
    assert reply["id"] == "1"
    assert reply["result"]["protocol"] == 1
    assert reply["result"]["python"]


def test_unknown_method_is_an_error_not_a_crash():
    (reply,) = run([{"id": "2", "method": "nope"}])
    assert reply["ok"] is False
    assert reply["error"]["code"] == ErrorCode.UNKNOWN_METHOD


def test_unparseable_frame_does_not_stop_the_loop():
    out = io.StringIO()
    server = Server(stdin=io.StringIO(), stdout=out)
    server.handle_line("{not json")
    server.handle_line(json.dumps({"id": "3", "method": "ping"}))
    replies = [json.loads(line) for line in out.getvalue().splitlines()]
    assert replies[0]["error"]["code"] == ErrorCode.BAD_REQUEST
    assert replies[1]["ok"] is True


def test_handler_exception_becomes_an_envelope():
    @method("test.boom")
    def _boom(server: Server, request: Request):
        raise RuntimeError("kaboom")

    (reply,) = run([{"id": "4", "method": "test.boom"}])
    assert reply["ok"] is False
    assert reply["error"]["code"] == ErrorCode.INTERNAL
    assert "kaboom" in reply["error"]["detail"]


def test_protocol_error_keeps_its_code():
    @method("test.coded")
    def _coded(server: Server, request: Request):
        raise ProtocolError(ErrorCode.MODEL_NOT_FOUND, "no model", "/x/y.pt")

    (reply,) = run([{"id": "5", "method": "test.coded"}])
    assert reply["error"]["code"] == ErrorCode.MODEL_NOT_FOUND
    assert reply["error"]["detail"] == "/x/y.pt"


def test_predict_without_a_model_reports_a_code_not_a_traceback():
    (reply,) = run([{"id": "6", "method": "predict", "params": {"image": "nope.jpg"}}])
    assert reply["ok"] is False
    assert reply["error"]["code"] == ErrorCode.IMAGE_NOT_FOUND


def test_dataset_check_runs_over_a_real_project(populated):
    (reply,) = run(
        [{"id": "7", "method": "dataset.check", "params": {"project": str(populated.root)}}]
    )
    assert reply["ok"] is True
    assert reply["result"]["images"] == 12
    assert reply["result"]["labelled"] == 10


def test_missing_project_is_a_coded_error():
    (reply,) = run([{"id": "8", "method": "dataset.check", "params": {}}])
    assert reply["error"]["code"] == ErrorCode.PROJECT_NOT_FOUND


def test_train_command_is_printable_without_running_anything(populated):
    (reply,) = run(
        [{"id": "9", "method": "train.command", "params": {"project": str(populated.root)}}]
    )
    command = reply["result"]["command"]
    assert "mode=train" in command
    assert any(part.startswith("epochs=") for part in command)


def test_capabilities_never_raises_when_torch_is_absent():
    (reply,) = run([{"id": "10", "method": "capabilities"}])
    assert reply["ok"] is True
    assert set(reply["result"]) >= {"predict", "train", "cuda", "pillow"}

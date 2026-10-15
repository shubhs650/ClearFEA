# SPDX-License-Identifier: AGPL-3.0-or-later
"""An in-process stand-in for the API's internal job routes, for tests."""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from pydantic import TypeAdapter, ValidationError

from clearfea_worker.spec.jobs_schema import (
    ClaimRequest,
    ClaimResponse,
    CompleteRequest,
    CompleteResponse,
    HeartbeatRequest,
    HeartbeatResponse,
)

# Every request and answer is checked against the shared schemas, so a test that passes
# here also proves the worker speaks the same wire format as the real API.
_complete_request: TypeAdapter[Any] = TypeAdapter(CompleteRequest)


class FakeApi:
    def __init__(self, token: str = "t") -> None:
        self.token = token
        self.queue: list[dict[str, Any]] = []
        self.jobs: dict[str, dict[str, Any]] = {}
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.heartbeat_action = "continue"
        #: Files the API serves to jobs, and files jobs uploaded, keyed by (job id, name).
        self.files: dict[tuple[str, str], bytes] = {}
        self.uploads: dict[tuple[str, str], bytes] = {}
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), self._handler())
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)

    @property
    def url(self) -> str:
        host, port = self._server.server_address[:2]
        return f"http://{host}:{port}"

    def enqueue(
        self,
        job_id: str,
        job_type: str = "noop",
        params: dict[str, Any] | None = None,
        downloads: dict[str, bytes] | None = None,
        uploads: tuple[str, ...] = (),
    ) -> None:
        transfers = []
        for name, content in (downloads or {}).items():
            self.files[(job_id, name)] = content
            transfers.append(
                {"name": name, "direction": "download", "url": self._file(job_id, name)}
            )
        for name in uploads:
            transfers.append({"name": name, "direction": "upload", "url": self._file(job_id, name)})
        job = {
            "id": job_id,
            "type": job_type,
            "targetId": None,
            "params": params,
            "transfers": transfers,
            "status": "queued",
        }
        self.queue.append(job)
        self.jobs[job_id] = job

    def _file(self, job_id: str, name: str) -> str:
        return f"{self.url}/internal/jobs/{job_id}/files/{name}"

    def __enter__(self) -> "FakeApi":
        self._thread.start()
        return self

    def __exit__(self, *exc: object) -> None:
        self._server.shutdown()
        self._server.server_close()

    def _handle(self, path: str, body: dict[str, Any]) -> tuple[int, dict[str, Any] | None]:
        self.calls.append((path, body))
        if path == "/internal/jobs/claim":
            ClaimRequest.model_validate(body)
            for job in self.queue:
                if job["type"] in body["jobTypes"]:
                    self.queue.remove(job)
                    job["status"] = "claimed"
                    keys = ("id", "type", "targetId", "params", "transfers")
                    answer = {"job": {k: job[k] for k in keys}}
                    return 200, _checked(ClaimResponse, answer)
            return 204, None
        parts = path.split("/")  # ['', 'internal', 'jobs', id, action]
        job = self.jobs[parts[3]]
        if parts[4] == "heartbeat":
            HeartbeatRequest.model_validate(body)
            job["status"] = "running"
            return 200, _checked(HeartbeatResponse, {"action": self.heartbeat_action})
        _complete_request.validate_python(body)
        job["status"] = body["status"]
        job["outcome"] = body
        answer = {"job": {k: job[k] for k in ("id", "type", "targetId", "status")}}
        return 200, _checked(CompleteResponse, answer)

    def _handler(self) -> type[BaseHTTPRequestHandler]:
        api = self

        class Handler(BaseHTTPRequestHandler):
            def _authorised(self) -> bool:
                if self.headers.get("Authorization") != f"Bearer {api.token}":
                    self._send(401, {"error": "The worker token is missing or wrong."})
                    return False
                return True

            def _file_key(self) -> tuple[str, str]:
                parts = self.path.split("/")  # ['', 'internal', 'jobs', id, 'files', name]
                return parts[3], parts[5]

            def do_GET(self) -> None:  # noqa: N802 (name fixed by BaseHTTPRequestHandler)
                if not self._authorised():
                    return
                content = api.files.get(self._file_key())
                if content is None:
                    self._send(404, {"error": "No such file."})
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)

            def do_PUT(self) -> None:  # noqa: N802 (name fixed by BaseHTTPRequestHandler)
                if not self._authorised():
                    return
                length = int(self.headers.get("Content-Length", 0))
                api.uploads[self._file_key()] = self.rfile.read(length)
                self._send(200, {"ok": True})

            def do_POST(self) -> None:  # noqa: N802 (name fixed by BaseHTTPRequestHandler)
                if not self._authorised():
                    return
                length = int(self.headers.get("Content-Length", 0))
                try:
                    status, body = api._handle(self.path, json.loads(self.rfile.read(length)))
                except ValidationError as error:
                    status, body = 400, {"error": f"Body does not match the schema: {error}"}
                self._send(status, body)

            def _send(self, status: int, body: dict[str, Any] | None) -> None:
                data = b"" if body is None else json.dumps(body).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *args: object) -> None:
                pass

        return Handler


def _checked(model: Any, body: dict[str, Any]) -> dict[str, Any]:
    model.model_validate(body)
    return body

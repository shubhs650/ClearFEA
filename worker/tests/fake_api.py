# SPDX-License-Identifier: AGPL-3.0-or-later
"""An in-process stand-in for the API's internal job routes, for tests."""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


class FakeApi:
    def __init__(self, token: str = "t") -> None:
        self.token = token
        self.queue: list[dict[str, Any]] = []
        self.jobs: dict[str, dict[str, Any]] = {}
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.heartbeat_action = "continue"
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), self._handler())
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)

    @property
    def url(self) -> str:
        host, port = self._server.server_address[:2]
        return f"http://{host}:{port}"

    def enqueue(self, job_id: str, job_type: str = "noop") -> None:
        job = {"id": job_id, "type": job_type, "targetId": None, "status": "queued"}
        self.queue.append(job)
        self.jobs[job_id] = job

    def __enter__(self) -> "FakeApi":
        self._thread.start()
        return self

    def __exit__(self, *exc: object) -> None:
        self._server.shutdown()
        self._server.server_close()

    def _handle(self, path: str, body: dict[str, Any]) -> tuple[int, dict[str, Any] | None]:
        self.calls.append((path, body))
        if path == "/internal/jobs/claim":
            for job in self.queue:
                if job["type"] in body["jobTypes"]:
                    self.queue.remove(job)
                    job["status"] = "claimed"
                    return 200, {"job": {k: job[k] for k in ("id", "type", "targetId")}}
            return 204, None
        parts = path.split("/")  # ['', 'internal', 'jobs', id, action]
        job = self.jobs[parts[3]]
        if parts[4] == "heartbeat":
            job["status"] = "running"
            return 200, {"action": self.heartbeat_action}
        job["status"] = body["status"]
        job["outcome"] = body
        return 200, {"job": {"id": job["id"], "status": body["status"]}}

    def _handler(self) -> type[BaseHTTPRequestHandler]:
        api = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # noqa: N802 (name fixed by BaseHTTPRequestHandler)
                if self.headers.get("Authorization") != f"Bearer {api.token}":
                    self._send(401, {"error": "The worker token is missing or wrong."})
                    return
                length = int(self.headers.get("Content-Length", 0))
                status, body = api._handle(self.path, json.loads(self.rfile.read(length)))
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

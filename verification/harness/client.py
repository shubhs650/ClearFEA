# SPDX-License-Identifier: AGPL-3.0-or-later
"""A small client for the ClearFEA API, signed in as one of the seeded local users."""

import http.cookiejar
import json
import time
import urllib.error
import urllib.request
from typing import Any


class ApiError(RuntimeError):
    pass


class Client:
    def __init__(self, base: str) -> None:
        self.base = base.rstrip("/")
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
        )

    def _send(self, method: str, path: str, body: bytes | None, kind: str | None) -> bytes:
        request = urllib.request.Request(self.base + path, data=body, method=method)
        if kind is not None:
            request.add_header("Content-Type", kind)
        try:
            with self.opener.open(request, timeout=120) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            text = error.read().decode("utf-8", "replace")
            raise ApiError(f"{method} {path} answered {error.code}: {text}") from None

    def json(self, method: str, path: str, body: Any = None) -> Any:
        data = None if body is None else json.dumps(body).encode()
        return json.loads(
            self._send(method, path, data, None if body is None else "application/json")
        )

    def bytes(self, path: str) -> bytes:
        return self._send("GET", path, None, None)

    def upload(self, path: str, content: bytes) -> Any:
        return json.loads(self._send("POST", path, content, "application/octet-stream"))

    def sign_in(self, login: str, password: str) -> None:
        self.json("POST", "/api/session", {"login": login, "password": password})

    def wait(self, path: str, key: str, busy: set[str], timeout: float) -> dict[str, Any]:
        """Polls GET path until body[key].status leaves `busy`; returns body[key]."""
        deadline = time.monotonic() + timeout
        while True:
            item = self.json("GET", path)[key]
            if item is not None and item["status"] not in busy:
                return item
            if time.monotonic() > deadline:
                raise ApiError(
                    f"{path} is still {item and item['status']} after {timeout:.0f} s. "
                    "Is the worker running? Its log says what it is doing."
                )
            time.sleep(1.0)

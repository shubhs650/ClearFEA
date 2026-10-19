# SPDX-License-Identifier: AGPL-3.0-or-later
"""A small client for the ClearFEA API, signed in as one of the seeded local users, or on the
live site as the verification account (M10.9, ADR-104)."""

import http.cookiejar
import json
import os
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

    def _send(
        self,
        method: str,
        path: str,
        body: bytes | None,
        kind: str | None,
        headers: dict[str, str] | None = None,
    ) -> bytes:
        request = urllib.request.Request(self.base + path, data=body, method=method)
        if kind is not None:
            request.add_header("Content-Type", kind)
        for name, value in (headers or {}).items():
            request.add_header(name, value)
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
        """Signs in as the verification account when CLEARFEA_VERIFY_TOKEN is set (the live site,
        where password sign-in is off), else with this seeded local login."""
        token = os.environ.get("CLEARFEA_VERIFY_TOKEN", "").strip()
        if token:
            headers = {"Authorization": f"Bearer {token}"}
            self._send("POST", "/api/session/verification", None, None, headers)
        else:
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

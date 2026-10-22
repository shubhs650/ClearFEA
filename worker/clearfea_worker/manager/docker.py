# SPDX-License-Identifier: AGPL-3.0-or-later
"""A small client for the Docker Engine API over its Unix socket (M12.1, ADR-107).

Only what the compute manager uses: images, volumes and containers. HTTP through the standard
library, so the manager needs no Docker SDK and nothing beyond the worker's locked dependencies.
"""

import http.client
import json
import socket
import struct
import urllib.parse
from typing import Any

#: The Engine API version the manager speaks. 1.44 is Docker Engine 25 and later; Docker 29 no
#: longer accepts anything older.
API_VERSION = "v1.44"
DEFAULT_SOCKET = "/var/run/docker.sock"


class DockerError(Exception):
    """The Docker daemon could not be reached or refused a request."""

    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


class _UnixConnection(http.client.HTTPConnection):
    def __init__(self, path: str, timeout: float) -> None:
        super().__init__("localhost", timeout=timeout)
        self._path = path

    def connect(self) -> None:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(self.timeout)
        sock.connect(self._path)
        self.sock = sock


def demux_logs(raw: bytes) -> str:
    """The text of a container's log stream. Without a terminal the daemon frames each chunk
    with an 8-byte header (stream, 3 zero bytes, big-endian length); anything else is taken as
    plain text."""
    out: list[bytes] = []
    at = 0
    while at + 8 <= len(raw) and raw[at] in (0, 1, 2) and raw[at + 1 : at + 4] == b"\0\0\0":
        (length,) = struct.unpack(">I", raw[at + 4 : at + 8])
        out.append(raw[at + 8 : at + 8 + length])
        at += 8 + length
    if at == 0:
        return raw.decode(errors="replace")
    return b"".join(out).decode(errors="replace")


class DockerClient:
    def __init__(self, socket_path: str = DEFAULT_SOCKET, timeout: float = 60.0) -> None:
        self._socket = socket_path
        self._timeout = timeout

    def _request(
        self,
        method: str,
        path: str,
        body: Any = None,
        query: dict[str, str] | None = None,
        timeout: float | None = None,
    ) -> tuple[int, bytes]:
        url = f"/{API_VERSION}{path}"
        if query:
            url += "?" + urllib.parse.urlencode(query)
        headers = {"Host": "docker"}
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        connection = _UnixConnection(self._socket, self._timeout if timeout is None else timeout)
        try:
            connection.request(method, url, body=data, headers=headers)
            response = connection.getresponse()
            return response.status, response.read()
        except OSError as error:
            raise DockerError(
                f"Cannot reach the Docker daemon at {self._socket}: {error}. Check that Docker "
                "is running and that the manager can read its socket."
            ) from None
        finally:
            connection.close()

    def _call(self, method: str, path: str, ok: tuple[int, ...], **kwargs: Any) -> Any:
        status, raw = self._request(method, path, **kwargs)
        if status not in ok:
            try:
                message = json.loads(raw).get("message", "")
            except (ValueError, AttributeError):
                message = raw.decode(errors="replace")
            raise DockerError(f"Docker answered {status} on {method} {path}: {message}", status)
        if not raw:
            return None
        try:
            return json.loads(raw)
        except ValueError:
            return raw

    def info(self) -> dict[str, Any]:
        return self._call("GET", "/info", (200,))

    def image_id(self, name: str) -> str | None:
        """The image's id (sha256:...), or None when no image of that name is loaded."""
        try:
            return self._call("GET", f"/images/{urllib.parse.quote(name, safe='')}/json", (200,))[
                "Id"
            ]
        except DockerError as error:
            if error.status == 404:
                return None
            raise

    def create_volume(self, name: str, labels: dict[str, str]) -> None:
        self._call("POST", "/volumes/create", (201,), body={"Name": name, "Labels": labels})

    def remove_volume(self, name: str) -> None:
        self._call("DELETE", f"/volumes/{name}", (204, 404), query={"force": "true"})

    def create_container(self, name: str, spec: dict[str, Any]) -> str:
        return self._call("POST", "/containers/create", (201,), body=spec, query={"name": name})[
            "Id"
        ]

    def start(self, container: str) -> None:
        self._call("POST", f"/containers/{container}/start", (204, 304))

    def inspect(self, container: str) -> dict[str, Any] | None:
        try:
            return self._call("GET", f"/containers/{container}/json", (200,))
        except DockerError as error:
            if error.status == 404:
                return None
            raise

    def wait(self, container: str, timeout: float) -> int:
        """Waits for the container to stop and returns its exit code."""
        answer = self._call("POST", f"/containers/{container}/wait", (200,), timeout=timeout)
        return int(answer["StatusCode"])

    def kill(self, container: str) -> None:
        # 409: the container is not running any more, which is what was asked for.
        self._call("POST", f"/containers/{container}/kill", (204, 409))

    def remove(self, container: str) -> None:
        self._call("DELETE", f"/containers/{container}", (204, 404), query={"force": "true"})

    def logs(self, container: str, tail: int = 50) -> str:
        status, raw = self._request(
            "GET",
            f"/containers/{container}/logs",
            query={"stdout": "1", "stderr": "1", "tail": str(tail)},
        )
        if status != 200:
            return ""
        return demux_logs(raw)

    def containers(self, label: str) -> list[dict[str, Any]]:
        """Every container, running or not, that carries the label (name=value)."""
        filters = json.dumps({"label": [label]})
        return self._call(
            "GET", "/containers/json", (200,), query={"all": "true", "filters": filters}
        )

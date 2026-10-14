# infra

Local Docker Compose files and, later, cloud deployment.

| File | Holds |
| --- | --- |
| `docker-compose.yml` | The worker container, reaching the API on the host through `host.docker.internal` |
| `dev.sh` | What `make dev` runs: the API and web app on the host and the worker in Compose, stopped together |
| `docker-compose.linux.yml` | Override for Docker Engine on Linux: host networking, API on `127.0.0.1` (ADR-016) |

Set `CLEARFEA_BUILD_CA` to a CA bundle file when building behind a TLS-intercepting proxy (ADR-012). See `worker/README.md` for a full run.

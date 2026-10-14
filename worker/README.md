# worker

Python job worker (`clearfea_worker`): claims jobs from the API, meshes with Gmsh and solves with CalculiX. Managed with `uv`; runs in Docker.

```
uv sync                                  # create .venv with dev tools
uv run pytest                            # tests (no Docker, no API needed)
uv run ruff check .
uv run python -m clearfea_worker check   # print CalculiX and Gmsh versions, load Gmsh
```

| Module | Holds |
| --- | --- |
| `runner.py` | Claim loop, heartbeats, outcome reporting |
| `api.py` | Client for the API's `/internal/jobs` routes |
| `jobs.py` | One handler per job type; only `noop` so far |
| `config.py` | Settings from environment variables |
| `versions.py` | CalculiX and Gmsh versions |

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `CLEARFEA_WORKER_TOKEN` | (required) | Same value as `WORKER_TOKEN` in `apps/api/.dev.vars` |
| `CLEARFEA_API_URL` | `http://127.0.0.1:8787` | API base URL |
| `CLEARFEA_WORKER_ID` | host name | Name recorded on claimed jobs |
| `CLEARFEA_POLL_SECONDS` | `2` | Pause when no job is queued or the API is unreachable |
| `CLEARFEA_HEARTBEAT_SECONDS` | `5` | Interval between heartbeats while a job runs |

## Image

The Dockerfile pins the base image by digest, `calculix-ccx=2.21-1` and Gmsh 4.15.2 (through `uv.lock`); see ADR-015. A version bump is its own pull request with a full verification run.

```
make worker-image                       # docker build -t clearfea-worker worker
docker run --rm clearfea-worker check   # CalculiX 2.21, Gmsh 4.15.2 initialised
```

Behind a TLS-intercepting proxy (the Claude Code cloud environment), pass its CA bundle as a build secret; it never lands in a layer: `make worker-image BUILD_CA=/root/.ccr/ca-bundle.crt`.

## Running a no-op job by hand

The simplest way is `make dev`, sign in at http://localhost:5173 as `alice` / `alice-local`, and press "Queue a no-op job" in the settings pane. Without the web app, queue one directly in the local D1.

```
cp apps/api/.dev.vars.example apps/api/.dev.vars
pnpm --filter @clearfea/api dev &
cd apps/api && npx wrangler d1 execute DB --local --command \
  "INSERT OR IGNORE INTO users (id, login, name) VALUES ('demo', 'demo', 'Demo');
   INSERT INTO jobs (id, owner_id, type) VALUES ('noop-1', 'demo', 'noop');" && cd ../..

# Linux: the worker shares the host network to reach wrangler on 127.0.0.1 (ADR-016).
docker compose -f infra/docker-compose.yml -f infra/docker-compose.linux.yml up --build worker
# Docker Desktop: docker compose -f infra/docker-compose.yml up --build worker
```

The worker logs `Claimed job noop-1 (noop)` and `Job noop-1 finished: succeeded`, and the row's `status` becomes `succeeded`.

# infra

Local Docker Compose files and, later, cloud deployment.

| File | Holds |
| --- | --- |
| `docker-compose.yml` | The worker container, reaching the API on the host through `host.docker.internal` |
| `dev.sh` | What `make dev` runs: the API and web app on the host and the worker in Compose, stopped together |
| `docker-compose.linux.yml` | Override for Docker Engine on Linux: host networking, API on `127.0.0.1` (ADR-016) |
| `vps/bootstrap.sh` | Sets up the solver VPS once over SSH (Ubuntu 24.04 or 22.04): updates, SSH by key only, firewall, Docker, the manager's environment file, the units, the first image (M12.5, ADR-131; `docs/DEPLOYMENT.md` section 4.3) |
| `vps/clearfea-manager.service` | The compute manager under systemd, as `docker run` of `clearfea-worker:current manager` |
| `vps/update-image.sh`, `vps/clearfea-image-update.{service,timer}` | Every 5 minutes: load the worker image the API names (or `CLEARFEA_IMAGE_PIN`) from its R2 archive and point `clearfea-worker:current` at it (ADR-110) |
| `vps/manager.env.example` | The manager's settings on the VPS, copied to `/etc/clearfea/manager.env` |
| `vps/worker-archive.sh` | The deploy workflow's Worker image job: tag by source, find, store and prune the archives in R2 |
| `aws/clearfea.yaml` | The live site's AWS stack: solver machines on Fargate, image store, launcher user, deploy role, budget alarm (M10.7, ADR-100; created by hand, `docs/DEPLOYMENT.md` section 4.3) |
| `aws/worker-image.sh` | The AWS side of the deploy workflow's Solver image job: find the image store, tag by source, retag `latest`, register machine definition revisions (M10.8, ADR-101) |

Set `CLEARFEA_BUILD_CA` to a CA bundle file when building behind a TLS-intercepting proxy (ADR-012). See `worker/README.md` for a full run.

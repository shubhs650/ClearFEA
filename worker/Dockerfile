# syntax=docker/dockerfile:1
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# ClearFEA job worker. Build from the repository root (or use `make worker-image`):
#   docker build --build-context spec=packages/spec -t clearfea-worker worker
# The `spec` context supplies packages/spec/units.json, the one units table (CLAUDE.md).
# Behind a TLS-intercepting proxy, pass its CA bundle as a build secret (ADR-012);
# it is read only during the build and never stored in a layer:
#   docker build --secret id=extra_ca,src=/path/to/ca-bundle.crt --build-context spec=packages/spec \
#     -t clearfea-worker worker
#
# Pinned on purpose (CLAUDE.md, ADR-015). Changing any of these is its own pull
# request with a full verification run:
#   - base image: Ubuntu 24.04 by digest, which provides Python 3.12
#   - CalculiX:   calculix-ccx 2.21-1 from the Ubuntu noble release pocket
#   - Gmsh:       gmsh 4.15.2 from PyPI (bundles its own OpenCASCADE), locked in uv.lock

ARG BASE=mirror.gcr.io/library/ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55

FROM ${BASE} AS build
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3.12 python3.12-venv ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY pyproject.toml uv.lock ./
RUN --mount=type=secret,id=extra_ca,required=false \
    set -eu; \
    if [ -s /run/secrets/extra_ca ]; then \
      export PIP_CERT=/run/secrets/extra_ca SSL_CERT_FILE=/run/secrets/extra_ca; \
    fi; \
    python3.12 -m venv /opt/uv \
 && /opt/uv/bin/pip install --no-cache-dir uv==0.11.32 \
 && UV_PROJECT_ENVIRONMENT=/opt/venv UV_PYTHON=/usr/bin/python3.12 UV_PYTHON_DOWNLOADS=never \
    /opt/uv/bin/uv sync --locked --no-dev --no-install-project --no-cache

FROM ${BASE}
ENV DEBIAN_FRONTEND=noninteractive
# Gmsh's wheel links against these system libraries even when run headless.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3.12 \
      calculix-ccx=2.21-1 \
      libgl1 libglu1-mesa libgomp1 libxrender1 libxcursor1 libxft2 libxinerama1 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /opt/venv /opt/venv
# The package itself is pure Python with no build step, so it is copied, not
# installed: installing would pull an unlocked build backend from PyPI.
COPY clearfea_worker /opt/worker/clearfea_worker
# Where clearfea_worker.units looks for the table: packages/spec/units.json beside the package's
# parent folder, as in a source checkout.
COPY --from=spec units.json /opt/packages/spec/units.json
RUN useradd --create-home --uid 10001 worker
USER worker
WORKDIR /home/worker
ENV PATH=/opt/venv/bin:$PATH PYTHONPATH=/opt/worker PYTHONUNBUFFERED=1
# The source commit the image was built from, reported with every claim (ADR-032). Last, so a
# new commit rebuilds only this layer.
ARG CLEARFEA_COMMIT=
ENV CLEARFEA_COMMIT=${CLEARFEA_COMMIT}
ENTRYPOINT ["python", "-m", "clearfea_worker"]
CMD ["run"]

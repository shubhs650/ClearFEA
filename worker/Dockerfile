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
#   - CalculiX:   2.21 from Ubuntu's calculix-ccx 2.21-1 source package, built with PaStiX
#                 (PaStiX4CalculiX and PaRSEC at pinned commits) by ccx/build.sh (ADR-063)
#   - Gmsh:       gmsh 4.15.2 from PyPI (bundles its own OpenCASCADE), locked in uv.lock
# LibreOffice Writer (without its GUI) turns the Word report into its PDF (M7.4, ADR-078), with
# Liberation Sans standing in for Arial at the same widths so the pages break where Word's do.

ARG BASE=mirror.gcr.io/library/ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55

# CalculiX with PaStiX, SPOOLES, ARPACK and the iterative solvers (ADR-063). PaStiX4CalculiX
# includes CUDA headers unconditionally, so the CUDA toolkit is needed here, and its runtime
# libraries below, though no GPU is used.
FROM ${BASE} AS ccx
ENV DEBIAN_FRONTEND=noninteractive
RUN sed -i 's/^Types: deb$/Types: deb deb-src/' /etc/apt/sources.list.d/ubuntu.sources \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential gfortran cmake git pkg-config ca-certificates python3 bison flex dpkg-dev \
      libopenblas-dev liblapacke-dev libhwloc-dev libscotch-dev libspooles-dev libarpack2-dev \
      nvidia-cuda-toolkit g++-12 \
 && rm -rf /var/lib/apt/lists/*
COPY ccx /src/ccx
RUN --mount=type=secret,id=extra_ca,required=false \
    set -eu; \
    if [ -s /run/secrets/extra_ca ]; then export GIT_SSL_CAINFO=/run/secrets/extra_ca; fi; \
    apt-get update; \
    PREFIX=/opt/ccx WORK=/tmp/ccx-build /src/ccx/build.sh; \
    rm -rf /tmp/ccx-build /var/lib/apt/lists/*

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
# CalculiX's runtime libraries (ADR-063): the solvers' and CUDA's, which the PaStiX build links.
# ca-certificates: machines on AWS reach the site over https (M10.9); without it every call
# fails with CERTIFICATE_VERIFY_FAILED.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3.12 ca-certificates \
      libarpack2t64 libspooles2.2t64 libscotch-7.0 libhwloc15 liblapacke libopenblas0-pthread \
      libgfortran5 libcublas12 libcudart12 \
      libgl1 libglu1-mesa libgomp1 libxrender1 libxcursor1 libxft2 libxinerama1 \
      libreoffice-writer-nogui fonts-liberation fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
COPY --from=ccx /opt/ccx/bin/ccx /usr/local/bin/ccx
COPY --from=ccx /opt/ccx/lib/libparsec.so.2 /opt/ccx/lib/libparsec.so.2
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

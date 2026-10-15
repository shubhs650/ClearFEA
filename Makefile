# SPDX-License-Identifier: AGPL-3.0-or-later
# Single entry point for ClearFEA. `make verify` and `make e2e` arrive with the suites they run.

.PHONY: help dev install spec spec-check test test-ts test-py lint format clean worker-image

help:
	@echo "make install   install TypeScript (pnpm) and Python (uv) dependencies"
	@echo "make dev       start the API (:8787), web app (:5173) and worker container; Ctrl-C stops all"
	@echo "make spec      regenerate TypeScript types and Pydantic models from packages/spec/schemas"
	@echo "make test      fast tier: generated-code check, unit tests, type checks and lint"
	@echo "make lint      lint only"
	@echo "make format    format Python code"
	@echo "make clean     remove installed dependencies and caches"
	@echo "make worker-image  build the worker Docker image (BUILD_CA=file for a proxy CA)"

install:
	pnpm install --frozen-lockfile
	uv sync --directory worker --locked

# BUILD_CA: CA bundle for building the worker image behind a TLS-intercepting proxy (ADR-012).
dev:
	CLEARFEA_BUILD_CA=$(BUILD_CA) infra/dev.sh

spec:
	pnpm --filter @clearfea/spec generate
	packages/spec/scripts/generate-python.sh

spec-check:
	pnpm --filter @clearfea/spec generate:check
	packages/spec/scripts/generate-python.sh --check

test: spec-check test-ts test-py

test-ts:
	pnpm run lint
	pnpm run typecheck
	pnpm run test

test-py:
	uv run --directory worker --locked ruff check .
	uv run --directory worker --locked ruff format --check .
	uv run --directory worker --locked pytest

lint:
	pnpm run lint
	uv run --directory worker --locked ruff check .

format:
	uv run --directory worker --locked ruff format .

clean:
	rm -rf node_modules apps/*/node_modules packages/*/node_modules worker/.venv

comma := ,
worker-image:
	docker build $(if $(BUILD_CA),--secret id=extra_ca$(comma)src=$(BUILD_CA)) --build-arg CLEARFEA_COMMIT=$$(git describe --always --dirty) --build-context spec=packages/spec -t clearfea-worker worker

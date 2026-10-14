# SPDX-License-Identifier: AGPL-3.0-or-later
# Single entry point for ClearFEA. `make dev`, `verify` and `e2e` are added by later M0 tasks.

.PHONY: help install test test-ts test-py lint format clean worker-image

help:
	@echo "make install   install TypeScript (pnpm) and Python (uv) dependencies"
	@echo "make test      fast tier: unit tests, type checks and lint"
	@echo "make lint      lint only"
	@echo "make format    format Python code"
	@echo "make clean     remove installed dependencies and caches"
	@echo "make worker-image  build the worker Docker image (BUILD_CA=file for a proxy CA)"

install:
	pnpm install --frozen-lockfile
	uv sync --directory worker --locked

test: test-ts test-py

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
	docker build $(if $(BUILD_CA),--secret id=extra_ca$(comma)src=$(BUILD_CA)) -t clearfea-worker worker

# Order Fulfillment Lab — one-click local commands.
# Run `make` (or `make help`) to list targets. Every target wraps a pnpm script
# from package.json, so the Makefile and the scripts never disagree.
#
# Ports (9003 is skipped: PhpStorm/Xdebug uses it):
#   Express  API 9001  web 9002  worker 9004
#   Fastify  API 9005  web 9006  worker 9007
#   Next.js  app 9008  realtime 9009  worker 9010

.DEFAULT_GOAL := help
SHELL := /bin/bash

PORTS := 9001 9002 9004 9005 9006 9007 9008 9009 9010

.PHONY: help setup install infra-up infra-down db-create codegen \
	express-seed express-dev express-build express-start express-test express-check express-open \
	fastify-seed fastify-dev fastify-build fastify-start fastify-test fastify-check fastify-open \
	nextjs-seed nextjs-dev nextjs-build nextjs-start nextjs-test nextjs-check nextjs-open \
	seed-all dev-all build-all start-all test-all test-packages check-all status stop bench

help: ## List all targets
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z0-9_-]+:.*## / {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# --- One-time setup ---------------------------------------------------------

setup: install infra-up db-create ## First run: install, start Elasticsearch, create databases

install: ## Install dependencies (pnpm workspace)
	pnpm install

infra-up: ## Start Elasticsearch (Docker, 127.0.0.1:9200)
	pnpm infra:up

infra-down: ## Stop Elasticsearch
	pnpm infra:down

db-create: ## Create all lab databases on local PostgreSQL
	pnpm db:create

codegen: ## Regenerate GraphQL types after a schema change
	pnpm codegen

# --- Express (API 9001, web 9002, worker 9004) ------------------------------

express-seed: ## Express: reset database and load demo data
	pnpm reset:express

express-dev: ## Express: dev servers -> http://localhost:9002
	pnpm dev:express

express-build: ## Express: production build
	pnpm build:express

express-start: express-build ## Express: build, then run production -> http://localhost:9001
	pnpm start:express

express-test: ## Express: all tests (HTTP + 14 acceptance scenarios)
	pnpm test:express

express-check: ## Express: type check and lint
	pnpm typecheck:express && pnpm lint:express

express-open: ## Express: open the dev UI in the browser
	open http://localhost:9002

# --- Fastify (API 9005, web 9006, worker 9007) ------------------------------

fastify-seed: ## Fastify: reset database and load demo data
	pnpm reset:fastify

fastify-dev: ## Fastify: dev servers -> http://localhost:9006
	pnpm dev:fastify

fastify-build: ## Fastify: production build
	pnpm build:fastify

fastify-start: fastify-build ## Fastify: build, then run production -> http://localhost:9005
	pnpm start:fastify

fastify-test: ## Fastify: all tests (HTTP + 14 acceptance scenarios)
	pnpm test:fastify

fastify-check: ## Fastify: type check and lint
	pnpm typecheck:fastify && pnpm lint:fastify

fastify-open: ## Fastify: open the dev UI in the browser
	open http://localhost:9006

# --- Next.js (app 9008, realtime 9009, worker 9010) -------------------------

nextjs-seed: ## Next.js: reset database and load demo data
	pnpm reset:nextjs

nextjs-dev: ## Next.js: dev servers -> http://localhost:9008
	pnpm dev:nextjs

nextjs-build: ## Next.js: production build
	pnpm build:nextjs

nextjs-start: nextjs-build ## Next.js: build, then run production -> http://localhost:9008
	pnpm start:nextjs

nextjs-test: ## Next.js: all tests (components, pages, routes, 14 acceptance scenarios)
	pnpm test:nextjs

nextjs-check: ## Next.js: type check and lint
	pnpm typecheck:nextjs && pnpm lint:nextjs

nextjs-open: ## Next.js: open the app in the browser
	open http://localhost:9008

# --- All variants -----------------------------------------------------------

seed-all: express-seed fastify-seed nextjs-seed ## Reset and seed all three databases

dev-all: ## Run all three variants in dev mode at once (Ctrl+C stops all)
	$(MAKE) -j3 express-dev fastify-dev nextjs-dev

build-all: ## Production build of everything
	pnpm build

start-all: build-all ## Build, then run all three in production mode at once
	$(MAKE) -j3 express-start-only fastify-start-only nextjs-start-only

.PHONY: express-start-only fastify-start-only nextjs-start-only
express-start-only:
	pnpm start:express
fastify-start-only:
	pnpm start:fastify
nextjs-start-only:
	pnpm start:nextjs

test-all: ## All tests, one package at a time (about 6 minutes)
	pnpm test

test-packages: ## Shared package tests only (domain, server-core, fixtures, SPA, contracts)
	pnpm --filter @ofl/domain test
	pnpm --filter @ofl/server-core test
	pnpm --filter @ofl/test-fixtures test
	pnpm --filter @ofl/web-spa test
	pnpm --filter @ofl/test-contracts test

check-all: ## Type check and lint everything
	pnpm typecheck && pnpm typecheck:scripts && pnpm lint && pnpm lint:scripts

# --- Utilities ----------------------------------------------------------------

status: ## Show which lab servers are running and healthy
	@for spec in "Express-API 9001 /health/live" "Express-web 9002 /" "Express-worker 9004 /health/live" \
	             "Fastify-API 9005 /health/live" "Fastify-web 9006 /" "Fastify-worker 9007 /health/live" \
	             "Next.js-app 9008 /api/health/live" "Next.js-realtime 9009 /health/live" "Next.js-worker 9010 /health/live"; do \
	  set -- $$spec; \
	  code=$$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://localhost:$$2$$3"); \
	  if [ "$$code" = "000" ]; then state="stopped"; else state="up ($$code)"; fi; \
	  printf "  %-18s :%-5s %s\n" "$$1" "$$2" "$$state"; \
	done

stop: ## Stop every lab server listening on the lab ports
	@pids=$$(for p in $(PORTS); do lsof -ti tcp:$$p -sTCP:LISTEN 2>/dev/null; done | sort -u | tr "\n" " "); \
	if [ -z "$$pids" ]; then echo "No lab servers running."; else echo "Stopping: $$pids"; kill $$pids; fi

bench: ## Run the benchmark suite on ofl_bench (load the bench profile first; see README)
	pnpm bench

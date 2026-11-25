# Completion checklist

Owner key: C = coordinator, Core = core agent, E = Express agent, F = Fastify agent, N = Next.js agent, R = reviewer.
Every "verified" result below was re-run by the coordinator, not only reported by an agent.

## Stage 1–4: foundation (C)
- [x] Workspace inspected; tool versions checked against the npm registry (ADR 0008)
- [x] pnpm workspace, strict TypeScript, ESLint, Jest ESM preset, compose.yaml (Elasticsearch 9.2.4)
- [x] 8 isolated databases on local PostgreSQL (`pnpm db:create`)
- [x] Migrations 0001 (schema), 0002 and 0003 (measured indexes)
- [x] GraphQL contract, client operations, codegen (operations, resolver types, embedded SDL)
- [x] `@ofl/domain` with unit tests
- [x] Requirements, acceptance scenarios, architecture, ADRs 0001–0009

## Stage 5–7: implementation and tests
- [x] Core: `@ofl/server-core` and `@ofl/test-fixtures` (Core)
- [x] Shared SPA `@ofl/web-spa` (E)
- [x] Express variant: API, worker, web entry, tests (E)
- [x] Acceptance suite `@ofl/test-contracts`, 14 scenarios (F)
- [x] Fastify variant: API, worker, web entry, tests (F)
- [x] Next.js variant: App Router, route handlers, Server Actions, realtime service, worker, tests (N)

## Stage 8: performance (C)
- [x] Bench dataset (20k products, 200k orders) loads in under 40 s; ledger reconciles
- [x] Provisional targets written before measuring (`docs/performance.md`)
- [x] Measured optimization 1: migration 0002, EXPLAIN ANALYZE before/after
- [x] Measured optimization 2: migration 0003, checkout profile before/after
- [x] Load scenarios: search, my orders, checkout (distinct and hot SKU), worker throughput

## Stage 9–10: review (R, C)
- [x] Independent review, two passes, with test runs and attacks on running servers
- [x] All high and medium findings fixed with regression tests (`reports/review-findings.md`)
- [x] Affected checks re-run

## Final verification (C, 2026-11-25)
- [x] `pnpm codegen` produces no diff
- [x] `pnpm typecheck`, `pnpm typecheck:scripts`: pass
- [x] `pnpm lint`, `pnpm lint:scripts`: pass
- [x] `pnpm test`: 380 tests pass (domain 53, server-core 112, test-fixtures 5, test-contracts 6, web-spa 32, Express 30, Fastify 34, Next.js 108)
- [x] `pnpm build`: all three variants build

## Documentation (C)
- [x] README, requirements, architecture, domain model, workflows, database design, GraphQL design, testing, performance, failure scenarios, stack comparison, interview guide, ADRs

## Not verified (reported, not claimed)
- UIs in a real browser (covered by jsdom component tests and HTTP checks only). Installing browser binaries or driving the user's browser is outside the project.
- A real PostgreSQL restart (needs a system-level service command).
- Next.js built-in Server Action Origin check against a crafted cross-site request.
- Benchmarks on an idle machine: unrelated host processes kept the load average high; each report records the load.

# Edible KDS — Production Kitchen Display System (demo)

A tablet-first production KDS for a made-to-order fruit-arrangement kitchen,
built to the spec in `docs/*.md` (Edible-Arrangements-style production flow:
FRUIT / CHOCOLATE / ASSEMBLY / PACKAGING stations, a recipe DAG per product,
QC with a rework loop, and a fulfillment staging/handoff step) — **not** a
generic ghost-kitchen order board. Every brand name, recipe, product name and
image placeholder in this repo is fictional (see `AGENTS.md` and
`packages/contracts/src/fixtures.ts`); nothing here is Edible Arrangements'
actual recipes, imagery or proprietary workflow.

## Stack

- **Monorepo:** npm workspaces — `apps/web` (Next.js 15 App Router), `packages/contracts`
  (Zod schemas + pure DAG/state-machine logic, no I/O), `packages/db` (Drizzle ORM
  schema/client/migrations), `packages/domain` (transactional business logic).
- **Postgres** via Drizzle ORM (not Prisma — see "Assumptions" below), with
  row locking (`SELECT ... FOR UPDATE`) and optimistic concurrency (a `version`
  column) for safe concurrent task transitions.
- **Real-time:** Server-Sent Events (`/api/stores/:storeId/events`) backed by a
  transactional outbox table, so an event is only visible to readers once its
  transaction has committed, and a client can resync from `Last-Event-ID` after
  a disconnect without missing anything.
- **Auth:** `iron-session` encrypted cookies, PIN-free email/password login,
  store-scoped role membership (`ASSOCIATE` / `QC` / `MANAGER` / `ADMIN`).

## Quick start

```bash
cp env.example .env        # defaults are fine for local/demo use
npm install
npm run dev                 # starts local Postgres, migrates, seeds, and runs `next dev`
```

Then open `http://localhost:3000`. Log in with one of the demo accounts
(all share the same password):

| Role      | Email                        | Password            |
|-----------|-------------------------------|----------------------|
| Admin     | `admin@petalpit.demo`         | `Demo-Pass-2026!`   |
| Manager   | `manager@petalpit.demo`       | `Demo-Pass-2026!`   |
| QC        | `qc@petalpit.demo`             | `Demo-Pass-2026!`   |
| Associate | `associate1@petalpit.demo`    | `Demo-Pass-2026!`   |
| Associate | `associate2@petalpit.demo`    | `Demo-Pass-2026!`   |

`npm run dev` runs `db:up` (a local Postgres cluster — see
`infra/local-postgres.sh`; use `infra/docker-compose.yml` instead if Docker is
available on your machine), `db:migrate`, and `db:seed` (one fictional store,
four stations, four demo products with different recipe-DAG shapes, and the
five users above) before starting the web app.

Useful scripts:

```bash
npm run db:reset      # drop + recreate + migrate + reseed
npm run test          # domain-layer unit/integration test suite (vitest)
npm run typecheck     # tsc --noEmit across contracts/db/domain
npm run simulate -- --rate=12            # continuous order generator, ~12/min, Ctrl+C to stop
npm run simulate -- --rate=6 --count=20  # stop after 20 orders
npm run simulate:day -- --count=40 --qc-fail-rate=0.15   # fast full-pipeline run: orders ->
                                                           # production -> QC (with rework) ->
                                                           # staging -> handoff, so the manager
                                                           # overview has real numbers to show
```

Both simulator scripts drive the real HTTP API over `fetch` (the same
endpoints a tablet would call), not the domain layer directly — `simulate.ts`
only creates orders (watch them land on station/expo screens in real time);
`simulate-day.ts` also logs in as an associate/QC/manager and plays the whole
order through to `COMPLETED`, so it's meant for quickly populating demo data,
not for watching the board update live.

## Screens

- `/station/<slug>` is the old ghost-kitchen-style URL from the generic brief;
  this build instead uses `/stores/<storeId>/stations/<stationId>` because
  station routing here is DB-backed and store-scoped, not a static slug list.
  The store layout's nav links to the right URLs for the logged-in user's
  stations, so you never need to type these by hand.
- **Station board** (`ASSOCIATE`): ticket cards in arrival order, allergen
  banners, live age-based urgency color, claim → start → complete, hold/resume,
  and an All-Day panel of open item counts.
- **Task screen**: a single guided task (used when tapping into a ticket item)
  showing the recipe step's media placeholder, dependencies, and sibling tasks.
- **QC board** (`QC`): the queue of items awaiting inspection, a fixed generic
  pass/fail checklist, and defect codes on fail (which spawns a rework task).
- **Fulfillment board** (`QC`/`MANAGER`): Pickup/Delivery columns sorted by
  promise time, per-station progress per order, stage (location + package
  count) and handoff actions — this is the "expo" screen from the generic
  brief, consolidated into one Fulfillment view.
- **Orders list/detail** (`MANAGER`/`ADMIN`): full order history and lifecycle
  timeline (`OrderEvent` audit trail).
- **Overview** (`MANAGER`/`ADMIN`): live KPIs — open orders, due-within-30,
  late, blocked, QC fail rate, per-station average cycle time, 24h throughput.
- **Admin → Recipes** (`MANAGER`/`ADMIN`, store-agnostic route at `/admin/recipes`):
  register a new product (SKU + name), author a draft recipe (ordered steps
  with station + duration + dependencies, plus components/allergens), and
  publish it. Brand/station/menu-item CRUD beyond this is not built — see
  "Not implemented" below.

All screens disconnect-detect: losing the SSE connection shows a banner,
keeps the last known state on screen, and resyncs automatically (replaying
missed events by sequence number) on reconnect — no manual refresh needed.

## Adding a new delivery-platform adapter

The only implemented intake adapter is the HMAC-signed demo webhook
(`POST /api/integrations/demo/orders`, see `packages/domain/src/adapters.ts`
and `scripts/lib/orderGen.ts` for a client example). It's intentionally the
"adapter boundary," not a real DoorDash/Uber Eats/Grubhub integration — per
`docs/08-security-integrations.md`, a real adapter needs that platform's
actual webhook contract first, which wasn't available here.

To add a real one:

1. Write a route handler (e.g. `apps/web/app/api/integrations/doordash/orders/route.ts`)
   that verifies that platform's actual signature scheme (not the demo HMAC
   scheme — copy the *shape* of `adapters.ts`'s verify/normalize/dedupe/ingest/
   acknowledge flow, not its crypto).
2. Normalize that platform's payload into `CreateOrderInput` (`packages/contracts/src/schemas.ts`)
   — map their menu/SKU identifiers to this system's `MenuItem.sku`.
3. Call `createOrder(storeId, input)` from `packages/domain/src/orders.ts` (it
   already handles recipe-snapshot freezing, task-DAG materialization, and
   `(store, source, externalId)` idempotency — you get dedup for free as long
   as you pass the platform's own order id as `externalId` and set
   `source` to a new value in the `orderSource` enum in `packages/db/src/schema.ts`).
4. Add an `inboxEvents.provider` value for the platform's event-id dedup table
   (mirrors the `"demo"` provider in `adapters.ts`), to protect against the
   platform retrying the same webhook delivery.

No orchestration code needs to change — station routing, the task DAG, QC,
and fulfillment are all keyed off the normalized order, not its source.

## Assumptions and scope decisions

- **Drizzle ORM instead of Prisma.** The brief's suggested stack named Prisma;
  Prisma's CLI needs to reach `binaries.prisma.sh` to download its query-engine
  binary, which was blocked by this environment's network egress policy.
  Drizzle has an equivalent transactional/typed-query feature set with no
  binary download step, so it was substituted rather than blocking the build.
- **Single demo store.** The demo adapter resolves "the" store with
  `db.select().from(stores).limit(1)` rather than a per-platform store
  mapping, since this MVP ships with exactly one seeded store. A real
  multi-store deployment would map platform store IDs to `storeId`.
- **QC checklist is a fixed, generic 4-item set in the UI**, not the
  DB-backed, per-brand `PackagingChecklist` CRUD the original generic brief
  described — the actual project spec (`docs/04-data-model.md`) doesn't model
  per-brand packaging checklists the same way, so this was built against the
  project's own data model instead.
- **No PIN-based "open with no login" station URLs.** The project's spec uses
  store-scoped RBAC with real sessions for every screen (including station
  boards), not the generic brief's "stations have no login" shortcut, because
  the real spec's threat model (`docs/08-security-integrations.md`) requires
  every endpoint and SSE subscription to be authorized.
- **No "Recall last bumped ticket" button.** The project's task state machine
  has `resume` (ON_HOLD → IN_PROGRESS) but no "un-complete a DONE task"
  action, since completed tasks feed an audit trail that's meant to be
  append-only; the generic brief's recall feature doesn't have an equivalent
  in this spec.
- **Cancelled-order visibility is a client-side "flash" pattern**, not a
  server-side flag kept forever in the active queues: `getStationQueue` and
  `getExpoQueue` intentionally exclude `CANCELLED` tasks/orders (so they don't
  clutter the live queue), and the Station/Fulfillment boards instead keep a
  just-cancelled card visible with a strikethrough + banner for ~20 seconds
  after the SSE `CANCELLED` event arrives, satisfying "cancellations are
  visibly flagged, not silently disappear" without permanently polluting the
  queue views. This flash isn't implemented on the QC board (QC's queue is
  keyed off QC-pending items, which a cancellation removes from contention
  entirely).
- **The manager Overview is a live snapshot, not a historical report.** It
  shows current open/late/blocked counts and today's rolling averages, not a
  "pick any past day" report — this matches `packages/domain/src/metrics.ts`'s
  own design (see its file comment) and was a deliberate simplification for
  the MVP; a historical/date-range report is a reasonable next step.
- **`simulate-day.ts`'s "day" is a fast pipeline run**, not a literal
  24-hour simulation: it creates a batch of orders and then immediately drains
  them through claim → start → complete → QC → (rework loop) → stage → handoff
  as fast as the HTTP round-trips allow, specifically so a demo or the
  Overview dashboard has realistic-looking numbers without waiting hours.
- **Single-process, in-memory pub/sub** (`global.__kdsBus`) feeding SSE from
  the outbox-polling publisher. This is correct and durable (the outbox table
  is the source of truth, so no event is lost even if the in-process bus
  drops it — a reconnecting client replays by sequence number), but it does
  not fan out across multiple server instances; a real multi-instance
  deployment needs a shared pub/sub (e.g. Postgres `LISTEN/NOTIFY`, or
  Redis) instead of the in-process `EventEmitter`.
- **No automated end-to-end (browser) test suite.** All 18 P0 acceptance
  scenarios (`docs/09-testing-acceptance.md`) are covered as domain-layer
  integration tests against a real Postgres transaction (see "Testing"
  below), and the full HTTP surface (auth, RBAC, order intake, the
  claim/start/complete pipeline, SSE + replay, QC, staging/handoff, the
  signed webhook, and page rendering) was exercised manually via `curl`
  during the build, but there's no scripted Playwright/HTTP E2E suite
  checked into the repo.
- `next lint` has not been interactively configured in this environment (it
  prompts for a config choice on first run); `npm run typecheck` is the
  enforced static check instead.

## Not implemented (explicit gaps vs. the fuller spec)

- Brand / station / menu-item CRUD admin screens (only product + recipe
  authoring exists under `/admin/recipes`).
- A historical/date-range reporting view (current Overview is a live
  snapshot only).
- Real third-party platform adapters (DoorDash/Uber Eats/Grubhub) — only the
  demo HMAC-signed adapter exists; see "Adding a new delivery-platform
  adapter" above for the intended extension point.
- Multi-instance horizontal scaling of the real-time layer (see "Assumptions").
- Sound/chime toggle per screen.
- A scripted browser-level E2E suite (domain-layer tests cover all P0
  acceptance scenarios; HTTP-level coverage so far is manual).

## Project structure

```
apps/web/                 Next.js app (pages, API routes, components)
packages/contracts/       Zod schemas, DAG validation, state machines (pure, no I/O)
packages/db/              Drizzle schema, migrations, seed script, client
packages/domain/          Transactional business logic (orders, tasks, QC, fulfillment, events)
scripts/                  Order simulator (simulate.ts, simulate-day.ts) + shared lib
infra/                    Local Postgres (no-Docker) + docker-compose.yml alternative
docs/                     Full product/technical spec (source of truth for this build)
```

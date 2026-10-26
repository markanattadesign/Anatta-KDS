# Edible KDS — Production Kitchen Display System (demo)

A tablet-first production KDS for a made-to-order fruit-arrangement kitchen
(Edible-Arrangements-style production flow: FRUIT / CHOCOLATE / ASSEMBLY /
PACKAGING stations, a recipe DAG per product, QC with a rework loop, and a
fulfillment staging/handoff step) — **not** a generic ghost-kitchen order
board. Every brand name, recipe, product name and image placeholder in this
repo is fictional (see `packages/contracts/src/fixtures.ts`); nothing here is
Edible Arrangements' actual recipes, imagery or proprietary workflow.

## Stack

- **Monorepo:** npm workspaces — `apps/web` (Next.js 15 App Router), `packages/contracts`
  (Zod schemas + pure DAG/state-machine logic, no I/O), `packages/db` (Drizzle ORM
  schema/client/migrations/seed), `packages/domain` (transactional business logic).
- **Postgres** via Drizzle ORM, with row locking (`SELECT ... FOR UPDATE`) and
  optimistic concurrency (a `version` column) for safe concurrent task taps.
- **Real-time:** Server-Sent Events (`/api/stores/:storeId/events`) backed by a
  transactional outbox table. An event becomes visible only once its transaction
  commits, and a reconnecting client resumes from `Last-Event-ID` without gaps.
- **Auth:** `iron-session` encrypted cookies, email/password login, store-scoped
  role membership (`ASSOCIATE` < `QC` < `MANAGER` < `ADMIN`).

## Quick start

Requires Node ≥ 22.13 and Postgres server binaries (`apt install postgresql` /
`brew install postgresql`), or Docker.

```bash
cp env.example .env
npm install
npm run dev        # starts local Postgres, migrates, seeds, then `next dev` on :3000
```

With Docker instead: `docker compose -f infra/docker-compose.yml up -d`, then
`npm run db:migrate && npm run db:seed && npm run dev -w web`.

Open `http://localhost:3000` and sign in (all accounts share one password):

| Role      | Email                        | Password          |
|-----------|------------------------------|-------------------|
| Admin     | `admin@ediblekds.demo`       | `Demo-Pass-2026!` |
| Manager   | `manager@ediblekds.demo`     | `Demo-Pass-2026!` |
| QC        | `qc@ediblekds.demo`          | `Demo-Pass-2026!` |
| Associate | `associate1@ediblekds.demo`  | `Demo-Pass-2026!` |
| Associate | `associate2@ediblekds.demo`  | `Demo-Pass-2026!` |

Then feed it orders:

```bash
npm run simulate                                  # 6 signed webhook orders, 4s apart
npm run simulate -- --count 20 --interval 2
npm run simulate -- --duplicates                  # re-sends each event: shows idempotency
```

## Scripts

```bash
npm run dev           # setup + next dev
npm run setup         # db:up + db:migrate + db:seed
npm run db:reset      # drop schema, migrate, reseed
npm run db:generate   # regenerate SQL migration after editing packages/db/src/schema.ts
npm test              # contracts unit tests + domain integration tests (real Postgres, db `kds_test`)
npm run typecheck     # tsc across contracts, db, domain and the web app
npm run build         # production build of apps/web
npm run smoke         # HTTP end-to-end check against a running server (KDS_URL=...)
```

`npm run smoke` drives the real HTTP API: role gates, signed webhook intake,
every station task as the DAG unlocks it, QC fail → rework → pass, staging,
handoff, a rejected double-handoff, and a live SSE subscriber that must see the
events.

## How the pipeline works

1. **Intake** — an order arrives by the signed demo webhook or the manager's
   "New order" form. `createOrder` freezes each item's published recipe as a
   snapshot and turns its step DAG into station tasks: steps with no
   dependencies start `READY`, the rest `BLOCKED`. Idempotent on
   `(store, source, externalId)`, including concurrent duplicate deliveries.
2. **Production** — associates `claim → start → complete` (plus `hold`/`resume`
   with a reason). Completing a task unblocks dependants whose parents are all
   done; when every task on an item is done, the item goes to QC.
3. **QC** — a 4-point checklist must be ticked to pass. A fail needs at least
   one defect code and spawns a `READY` rework task at Assembly; once it's done
   the item returns to the QC queue, flagged as a re-inspection.
4. **Fulfillment** — when every item has passed, the order is `READY`. It can be
   staged (shelf + package count) and handed off (picked up / given to driver).
5. **Cancellation** (manager) cancels every open task; station and fulfillment
   boards keep the card visible with a red banner for 20 seconds so nobody keeps
   working on it.

Each step writes to the per-order audit trail (Orders → order detail → Timeline)
and to the outbox (live screens).

## Screens

- **Station board** (`/stores/:storeId/stations/:stationId`, ASSOCIATE+):
  tickets sorted by promise time, urgency colour (green, amber under 15 min, red when
  late), allergen and note banners, big touch targets, per-task elapsed vs target,
  "Mine + unclaimed" filter, an All-day panel (open quantities per step) and an
  Upcoming panel (blocked work and what it waits on, at which station). Tapping
  a task opens its instructions, dependencies and a step-photo placeholder.
- **QC board** (QC+): items awaiting inspection, components to check against,
  previous failures, pass/fail with defect codes.
- **Fulfillment board** (QC+): Pickup / Delivery columns, per-station progress,
  stage / move / hand off.
- **Orders** (MANAGER+): filterable history, manual order entry, order detail
  with tasks, QC attempts and full timeline, cancel.
- **Overview** (MANAGER+): live KPIs — open, due within 30 min, late, ready, on
  hold, waiting on dependencies, 24h QC fail rate, completions, on-time rate,
  lead time, and per-station cycle time vs target.
- **Recipes** (`/admin/recipes`, MANAGER+ in any store): create products, edit
  steps (station, target time, dependencies, instructions), components and
  allergens. The DAG is validated live (cycles, unknown or duplicate steps) with the
  computed step order and minimum production time. Saving writes a draft;
  publishing makes it the version new orders use. In-flight orders keep their
  snapshot.

Every live screen shows a Live/Offline indicator. On disconnect it shows a
banner, keeps the last known state, and resyncs automatically on reconnect
(and when a sleeping tablet wakes).

## Adding a delivery-platform adapter

The only intake adapter is the HMAC-signed demo webhook,
`POST /api/integrations/demo/orders` (`packages/domain/src/adapters.ts`;
`scripts/simulate.mts` is a client example):

```
X-KDS-Timestamp: <ms since epoch>            (rejected if more than 5 min skew)
X-KDS-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<raw body>" with DEMO_ADAPTER_SECRET>
```

To add a real platform:

1. Add a route (e.g. `apps/web/app/api/integrations/<platform>/orders/route.ts`)
   that verifies **that platform's** signature scheme. Copy the
   verify → normalise → dedupe → ingest → acknowledge flow, not the demo crypto.
2. Normalise the payload into `CreateOrderInput` (`packages/contracts/src/schemas.ts`),
   mapping their item IDs to `menu_items.sku`.
3. Add a value to `ORDER_SOURCES` and call `createOrder(storeId, input)` with the
   platform's order id as `externalId`. That gives you snapshotting, task
   materialisation and idempotency.
4. Record delivery ids in `inbox_events` under a new `provider` value to absorb
   webhook retries.

## Assumptions and scope decisions

- **Single demo store.** The demo adapter routes to the only store. A
  multi-store deployment needs a platform-store → `storeId` mapping.
- **Products/recipes are brand-wide**; stations and orders are per store.
- **Fixed generic QC checklist** (4 items, in `packages/contracts`), not a
  per-product checklist editor.
- **Real sessions on every screen**, including station boards, with every API
  route and SSE stream authorised by store role.
- **No "recall a completed task".** The audit trail is append-only. Mistakes
  are corrected via QC fail → rework.
- **Overview is a live snapshot** (current counts + rolling 24h), not a
  date-range report.
- **Single-process real-time fan-out.** An in-process bus polls the outbox
  every 300 ms. It is durable (clients replay from the outbox) but doesn't fan
  out across server instances; scaling out needs a shared bus such as Postgres
  `LISTEN/NOTIFY`. Outbox writers take a transaction-level advisory lock so
  sequence numbers follow commit order and a poller can never skip a late commit.
- **Secrets:** `SESSION_SECRET` and `DEMO_ADAPTER_SECRET` in `env.example` are
  demo placeholders. Replace them for any shared deployment.

## Not implemented yet

- Store / station / user admin screens (seeded only).
- Historical reporting and CSV export.
- Real delivery-platform adapters.
- Sound / chime per screen.
- Browser-level E2E tests (domain integration tests + the HTTP `smoke` script
  cover the flows).
- ESLint (the deprecated `next lint` script was removed; `typecheck` is the
  enforced static check).

## Project structure

```
apps/web/               Next.js app: pages, API routes, components, SSE bus
packages/contracts/     Zod schemas, DAG validation, state machines, demo fixtures (pure)
packages/db/            Drizzle schema, SQL migrations, seed, client
packages/domain/        Transactional business logic + integration tests
scripts/                simulate.mts (order generator), smoke.mts (HTTP E2E check)
infra/                  local-postgres.sh (no Docker) and docker-compose.yml
```

# Fair Drop web app

Phases 1 through 5 of the Fair Drop prototype. The landing page adapts the ForumX Conference Template's bold event hero, blue accent, and spacious layout. The original template's MIT license is preserved in `LICENSE`.

## Run locally

```powershell
cd web
npm install
npm run dev
```

Open `http://localhost:3000`. Local development creates a durable PostgreSQL-compatible PGlite database in `web/.data/pglite`, applies `db/schema.sql`, and seeds one open demo event plus six buyer accounts. The initial entry window closes 24 hours after the first seed. Use **Start fresh demo** in the organizer console to create a new open event while preserving old events and simulation results. `PGLITE_DATA_DIR` can select an isolated local test database.

For hosted PostgreSQL (including a Supabase PostgreSQL connection), set `DATABASE_URL`, `SESSION_SECRET`, and `ADMIN_SECRET` from `.env.example`. The app applies the same schema and initial seed on first access. Never put these secrets in `NEXT_PUBLIC_` variables. The ignored local `web/.env.local` holds a generated organizer secret for the demo; use that value on `/admin`.

`npm run build` checks the production bundle. `npm run start` also requires `SESSION_SECRET`, even when using the local database. The Supabase-hosted connection has not been exercised because this workspace has no credentials yet.

## Current routes

- `/` - event landing and demo account selection
- `/queue` - authoritative account status, reservation timer, and simulated checkout; polling every 2.5 seconds
- `GET /api/events/:id` - public event data
- `POST /api/events/:id/join` - join or resume the one queue entry for the signed-in account
- `GET /api/events/:id/me` - authoritative buyer state
- `GET /api/demo-accounts` and `POST /api/session` - demo account selection
- `POST /api/admin/session` - separate organizer session, enabled when `ADMIN_SECRET` is configured
- `/admin` - organizer login; signed-in organizers continue to `/admin/events/:id`
- `/admin/events/:id` - organizer controls, metrics, decisions, and safe fresh-demo action
- `/admin/events/:id/lab` - organizer-only Fairness Lab with isolated simulation runs and cohort results
- `GET /api/admin/events/:id/lab` and `POST /api/admin/events/:id/lab/run` - run history and simulator launch
- `GET /api/admin/events/:id` - organizer event and queue summary
- `GET /api/admin/events/:id/metrics` - inventory, queue, request, order, and audit metrics (organizer only)
- `POST /api/admin/events/:id/open-entry` - draft to open transition
- `POST /api/admin/events/:id/close-entry` - freeze and randomly order eligible entries once
- `POST /api/admin/events/:id/start-sale` - enable admission after ordering
- `POST /api/admin/events/:id/admit` - admit up to the active capacity; requires an `Idempotency-Key` header
- `POST /api/events/:id/reserve` - admitted buyer reserves one ticket; requires an `Idempotency-Key` header and JSON object body
- `POST /api/reservations/:id/confirm` - owner confirms simulated purchase; repeated calls return the same order
- `POST /api/admin/events/:id/expire-holds` - release due holds and restore stock
- `POST /api/admin/events/:id/reset-demo` - idempotently create and select a fresh demo event

Demo accounts are intentionally selectable, so they demonstrate account-level uniqueness rather than one-human-one-account identity. A buyer who has joined keeps the same entry and position across refreshes. Late joins are rejected after close. Reserve, confirm, and expiry use database transactions and keep inventory balanced. Due holds are released on buyer status, organizer summary, admission, reservation, and the organizer trigger. There is no background scheduler yet, so holds may remain in the database until one of these paths runs.

Join requests allow 12 per signed account and 120 per proxy address per event per 60-second fixed window; status requests allow 90 per account and 600 per address. Excess returns HTTP 429 with `RATE_LIMITED` and `Retry-After`. Address is hashed before storage. The database-backed limiter works across app instances sharing the same database, but a proxy must supply a trustworthy forwarded address for the secondary limit. Demo account selection is intentionally open, so this is not proof of one human per account. Bucket rows are not automatically pruned yet.

To check local database constraints after at least one account has joined, stop the app and run `node scripts/check-phase1-db.mjs`. It checks the inventory and unique-entry constraints and creates a closed test event for API verification.

For the Phase 2 API check, stop the app and run `node scripts/seed-phase2-fixture.mjs`; save the event ID it prints. Restart the app, set `PHASE2_EVENT_ID` to that ID, and run `node scripts/verify-phase2.mjs`. The check covers the draft/open/close/selling transitions, unique frozen positions, late-entry rejection, batch capacity, idempotent admission, expiry, and the inventory invariant. It uses a separate event so the main landing page sale stays open.

For the Phase 3 API check, stop the app and run `node scripts/seed-phase3-fixtures.mjs`; save the JSON it prints. Restart the app, set `PHASE3_FIXTURES` to that JSON, and run `node scripts/verify-phase3.mjs`. It checks a simultaneous last-ticket reserve, duplicate confirm, conflicting idempotency key, owner binding, expiry and confirm races, reconnect state, and inventory totals. The fixtures are isolated from the landing page event.

For the Phase 4 check, use an isolated `PGLITE_DATA_DIR`: run `node scripts/seed-phase4-evidence.mjs`, start the app on port 3001 with that same variable, and run `node scripts/verify-phase4.mjs` (set `BASE_URL` if the port differs). Stop the app, then run `node scripts/check-phase4-evidence.mjs` with the same directory. This tests throttling, authorization, queue preservation, metrics, reset idempotency, and completed simulation evidence preservation without changing the main demo.

## Phase 5 Fairness Lab

The buyer status page includes a fairness receipt with accepted time, ordering policy, final position, admission and purchase outcomes, and reason codes. A position does not guarantee a ticket. The lab compares Fair Drop HTTP API outcomes with a labeled first-request-wins model; the model never creates orders. Each run has its own event and accounts and preserves the main sale.

To reproduce the Phase 5 check, start the app, then set LAB_BASE_URL to its URL and run `node scripts/verify-phase5.mjs`. The check creates two separate runs with seed `phase5-check`, 9 logical buyers, 3 tickets, and at most 4 simultaneous requests. It checks comparable cohort outcomes, throttling, zero oversells and duplicate orders, untouched source orders, run history, and a buyer receipt. For a single run, use `node scripts/run-fairness-lab.mjs`; override LAB_SEED, LAB_POPULATION, LAB_INVENTORY, LAB_CONCURRENCY, and LAB_SOURCE_EVENT_ID as needed. Supported bounds are 6-24 logical buyers, 1-population tickets, and 1-8 concurrent HTTP requests. Runs are stored in `simulation_runs` and visible at `/admin/events/:id/lab`.


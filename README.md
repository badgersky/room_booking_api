# Room Booking API (PostgreSQL edition)

![CI](https://github.com/badgersky/room_booking_api/actions/workflows/ci.yml/badge.svg)

Node.js 22 · Express 5 · Zod · Knex · PostgreSQL 16 · Jest · Docker Compose.

## 1. Quick start - Docker Compose (one command)

Requirements: Docker with Compose v2. Nothing else (no Node.js, no PostgreSQL) is needed on the machine.

```bash
git clone https://github.com/badgersky/room_booking_api.git
cd room_booking_api
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env
docker compose up --build
```

* API: http://localhost:3000/api
* Swagger UI: http://localhost:3000/api/docs

The `api` container waits for the `db` healthcheck, runs `knex migrate:latest` and starts the server.
Demo data with the ADMIN account (admin@example.com / admin-password-123) - run in a second terminal:

```bash
docker compose exec api npx knex seed:run
```

| Command | What it does |
| --- | --- |
| `docker compose up -d --build` | same in the background |
| `docker compose ps` | state of both services (`db` should be `healthy`) |
| `docker compose logs -f api` | API logs (migrations, requests, `[notification]`) |
| `docker compose exec db psql -U postgres -d room_booking` | SQL console (user/db from `.env`) |
| `docker compose down` | stop and remove containers - data stays in the `pgdata` volume |
| `docker compose down -v` | ... together with the volume (data is lost) |

Inside Compose the API connects to the host `db` (`DATABASE_URL` is set in `docker-compose.yml`);
`DATABASE_URL` in `.env` is only used when the API runs without Docker.

## 2. Running the API without Docker (database still in Docker, on this computer)

```bash
cp .env.example .env        # DATABASE_URL points to localhost:5432 - the "db" service below
docker compose up -d db     # only PostgreSQL, published on localhost:5432
npm install
npm run migrate:latest      # creates the schema (migrations only - no hand-written CREATE TABLE)
npm run seed:run            # demo data, safe to repeat (TRUNCATE ... RESTART IDENTITY)
npm start                   # http://localhost:3000
```

| Command | What it does |
| --- | --- |
| `npm run migrate:status` / `migrate:rollback` / `migrate:latest` | schema history |
| `npm run seed:run` | reset to the demo data |
| `DEBUG=knex:query npm start` | print every SQL query (PowerShell: `$env:DEBUG="knex:query"; npm start`) |
| `STORAGE=memory npm start` | in-memory repositories instead of PostgreSQL (no DB needed) |
| `npm run double-booking` | 10 parallel identical bookings, prints status codes + CONFIRMED count from SQL |
| `node scripts/add-reservations.js 15` | adds 15 extra reservations (to compare query logs for 5 vs 20 rows) |

The storage implementation is chosen in exactly one place: `src/server.js`.

## 3. Tests

```bash
npm run test:unit           # service rules, in-memory repositories + injected clock - no database needed
npm run test:integration    # Supertest -> Express -> PostgreSQL (separate TEST database)
npm test                    # both
```

Integration tests never use the development database. They connect to `TEST_DATABASE_URL`, default
`postgres://postgres:postgres@localhost:5432/room_booking_test` (see `tests/setupEnv.js`), so `DB_USER` / `DB_PASSWORD`
in `.env` must be `postgres` / `postgres` for the default to work (otherwise set `TEST_DATABASE_URL`).
`room_booking_test` is created automatically on the first start of the `db` container
(`docker/initdb/01-create-test-db.sql`). With an older volume create it by hand:

```bash
docker compose up -d db
docker compose exec db psql -U postgres -c "CREATE DATABASE room_booking_test;"
```

The schema is created by migrations in `beforeAll`, every test starts from `TRUNCATE ... RESTART IDENTITY`.

## 4. Events and audit log

`reservationsService` publishes events through an in-process event bus (`src/events/eventBus.js`, `EventEmitter` with
isolated listeners) **after** the transaction commits:

| Event | Payload |
| --- | --- |
| `reservation.created` | `{ reservationId, roomId, userId, startTime, endTime }` |
| `reservation.cancelled` | `{ reservationId, roomId, userId, cancelledBy }` |

A failed operation (e.g. `409`) and a repeated (idempotent) cancel publish nothing. Listeners:
`auditListeners.js` stores every event in `audit_log` (`payload jsonb`), `notificationListeners.js` logs
`[notification] to: <owner email> ...` when an ADMIN cancels somebody else's reservation.
`GET /api/admin/audit-log?eventType=&page=&limit=` (ADMIN only) returns the log, newest first.

## 5. Structure

```
knexfile.js                     knex config (DATABASE_URL), also used by the CLI
src/db/knex.js                  the single connection pool
src/db/migrations/              schema + exclusion constraint (separate migration)
src/db/seeds/01_demo_data.js    demo data, idempotent
src/db/seedData.js              sample data shared by the Knex seed and the in-memory store
src/db/unitOfWork.knex.js       runInTransaction -> repositories bound to one transaction
src/db/unitOfWork.memory.js     same interface, in memory
src/modules/*/*.repository.knex.js     the ONLY code that knows table/column names (+ snake_case <-> camelCase)
src/modules/*/*.repository.memory.js   same interface, kept for later
src/events/                     event bus + listeners (audit log, notification)
src/modules/admin/              GET /api/admin/audit-log
tests/unit/                     unit tests (no database)
tests/integration/              Supertest + test database
Dockerfile, docker-compose.yml  api + db
scripts/double-booking.js       race condition demo
```

## 6. Design decisions / answers for the report

**ON DELETE.** Both foreign keys use `RESTRICT`. A reservation is a business record (who booked what and when); silently
deleting it together with a room (`CASCADE`) would destroy history, and `SET NULL` would leave reservations that belong to
no room. With `RESTRICT` a room that has reservations (and a building that has rooms) cannot be removed by accident.

**Indexes.** `reservations (room_id, start_time, end_time)` serves the collision query. The unique index
`rooms (building_id, name)` also serves lookups by `building_id` (leading column). The exclusion constraint adds a partial
GiST index on CONFIRMED rows.

**No N+1.** Every read joins in one query; `roomsCount` uses `LEFT JOIN ... GROUP BY` (an `INNER JOIN` would drop buildings
without rooms). `GET /api/reservations` = 2 SQL queries (page + total) plus BEGIN/COMMIT, for 5 or 20 rows alike.

**Pagination / sort.** `WHERE`, `ORDER BY`, `LIMIT`, `OFFSET` run in PostgreSQL. Sort values come from a Zod whitelist and are
mapped to column names in the repository (column names cannot be bound parameters, so user input never reaches the SQL text).
`id` is the tie-breaker. `from`/`to` use overlap on a half-open range: `start_time < to AND end_time > from`.

**Which row is locked and why.** `SELECT id FROM rooms WHERE id = ? FOR UPDATE` - the *room* row. The rule "no two overlapping
CONFIRMED reservations" is per room, so the room is the resource that has to be serialized: bookings of the same room queue up,
bookings of different rooms do not block each other.

**Why a transaction alone is not enough.** PostgreSQL's default isolation level is READ COMMITTED: each statement sees only data
committed before it started. Two transactions can both run the collision `SELECT`, both see "no collision" (neither has
committed yet), and both `INSERT`. A transaction gives atomicity, not serialization of concurrent check-then-act logic.
The row lock makes the second transaction wait until the first commits, so its check then sees the new row. The exclusion
constraint is the last line of defence that holds even if someone forgets the lock or runs several API instances.

**Database errors -> HTTP.** `23505` -> 409 `UNIQUE_VIOLATION`, `23503` -> 409, `23514` -> 400,
`23P01` on `reservations_no_overlap` -> 409 `ROOM_ALREADY_BOOKED`. `err.detail` (table/column/value) is never sent to the client.

**Adding the exclusion constraint to existing data.** The migration fails if the table already contains overlapping CONFIRMED
rows (PostgreSQL will not add a constraint that existing data violates) - clean them first (or `npm run seed:run` in development).

## 7. Reproducing the race condition demo (Task 5)

The final code contains no artificial delay. To reproduce the three runs, temporarily edit
`src/modules/reservations/reservations.service.js` inside `createReservation`, restart the server, run `npm run double-booking`:

| Variant | Edit | Database | Expected |
| --- | --- | --- | --- |
| Before the fix | remove `await rooms.lockById(...)`; add `await new Promise(r => setTimeout(r, 200));` right before `reservations.create(` | `npx knex migrate:down` (drops the constraint) | many `201`, several CONFIRMED rows |
| After the fix | keep the delay, keep the lock | `npx knex migrate:latest` (after `npm run seed:run` if duplicates exist) | one `201`, nine `409` |
| Application check off | also remove the lock and the `if (collision) { throw ... }` block, keep the delay | constraint present | one `201`, nine `409`, no `500` |

Remove the delay afterwards.

# Room Booking API (PostgreSQL edition)

Node.js 22 · Express 5 · Zod · Knex · PostgreSQL 16 (Docker).

## 1. Start the database (on the computer that has Docker)

Copy `docker-compose.yml` to that computer, next to it create a `.env` file:

```
POSTGRES_USER=postgres
POSTGRES_PASSWORD=pick_a_real_password
POSTGRES_DB=room_booking
```

```bash
docker compose up -d        # starts postgres:16, data lives in the named volume room-booking-pgdata
docker compose ps           # STATUS should become "healthy"
```

Same thing without compose:

```bash
docker run --name room-booking-db \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=pick_a_real_password -e POSTGRES_DB=room_booking \
  -p 5432:5432 -v room-booking-pgdata:/var/lib/postgresql/data -d postgres:16
```

Let the other computer in:

* find the Docker computer's LAN IP (`ipconfig` on Windows, `ip a` on Linux), e.g. `192.168.1.50`,
* allow inbound TCP 5432 in its firewall. Windows (PowerShell as admin):
  `New-NetFirewallRule -DisplayName "Postgres 5432" -Direction Inbound -Protocol TCP -LocalPort 5432 -Action Allow`
* use a real password - the database is reachable by everyone in that network.
  (Alternative that exposes nothing: `ssh -L 5432:localhost:5432 user@192.168.1.50`, then use `localhost` in `DATABASE_URL`.)

Useful commands on the Docker computer:

```bash
docker exec -it room-booking-db psql -U postgres -d room_booking     # SQL console (\dt, \d reservations, \q)
docker logs room-booking-db
docker stop room-booking-db && docker start room-booking-db          # data stays
```

## 2. Run the API (on your computer)

```bash
cp .env.example .env        # then set DATABASE_URL=postgres://USER:PASSWORD@192.168.1.50:5432/room_booking
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

## 3. Structure

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
scripts/double-booking.js       race condition demo
```

## 4. Design decisions / answers for the report

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

## 5. Reproducing the race condition demo (Task 5)

The final code contains no artificial delay. To reproduce the three runs, temporarily edit
`src/modules/reservations/reservations.service.js` inside `createReservation`, restart the server, run `npm run double-booking`:

| Variant | Edit | Database | Expected |
| --- | --- | --- | --- |
| Before the fix | remove `await rooms.lockById(...)`; add `await new Promise(r => setTimeout(r, 200));` right before `reservations.create(` | `npx knex migrate:down` (drops the constraint) | many `201`, several CONFIRMED rows |
| After the fix | keep the delay, keep the lock | `npx knex migrate:latest` (after `npm run seed:run` if duplicates exist) | one `201`, nine `409` |
| Application check off | also remove the lock and the `if (collision) { throw ... }` block, keep the delay | constraint present | one `201`, nine `409`, no `500` |

Remove the delay afterwards.

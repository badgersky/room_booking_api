// Fires 10 identical POST /api/reservations at the same moment (same room, same time range)
// and then asks the database how many CONFIRMED reservations exist for that room and range.
//
// Usage:  node scripts/double-booking.js
// Env:    API_URL (default http://localhost:3000), ROOM_ID (default 1), DATABASE_URL (from .env)
//
// Expected with the fix in place: exactly one 201, nine 409 and exactly one CONFIRMED row in the database.
const HOUR = 60 * 60 * 1000;
const REQUESTS = 10;

try {
  process.loadEnvFile();
} catch {
  // no .env file
}

const db = require("../src/db/knex");

const BASE = process.env.API_URL ?? "http://localhost:3000";
const ROOM_ID = Number(process.env.ROOM_ID ?? 1);

// A random slot in 2030-2038, so repeated runs never collide with rows left by earlier runs
function randomSlot() {
  const day = Math.floor(Math.random() * 3000);
  const hour = 8 + Math.floor(Math.random() * 9);
  const start = new Date(Date.UTC(2030, 0, 1) + day * 24 * HOUR + hour * HOUR);
  return { start, end: new Date(start.getTime() + HOUR) };
}

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "anna.nowak@example.com", password: "anna-password-123" })
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  return (await res.json()).accessToken;
}

async function book(slot, token) {
  const res = await fetch(`${BASE}/api/reservations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      roomId: ROOM_ID,
      participants: 2,
      startTime: slot.start.toISOString(),
      endTime: slot.end.toISOString()
    })
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, code: body.error?.code };
}

async function main() {
  const slot = randomSlot();
  const token = await login();
  console.log(`Room ${ROOM_ID}, ${slot.start.toISOString()} - ${slot.end.toISOString()}`);
  console.log(`Sending ${REQUESTS} identical requests in parallel...\n`);

  const results = await Promise.all(Array.from({ length: REQUESTS }, () => book(slot, token)));

  results.forEach((r, i) =>
    console.log(`request ${String(i + 1).padStart(2)} -> ${r.status}${r.code ? ` ${r.code}` : ""}`)
  );

  const summary = {};
  for (const r of results) summary[r.status] = (summary[r.status] ?? 0) + 1;
  console.log("\nstatus summary:", Object.entries(summary).map(([s, n]) => `${s} x${n}`).join(", "));

  const { rows } = await db.raw(
    `SELECT count(*)::int AS confirmed
       FROM reservations
      WHERE room_id = ? AND status = 'CONFIRMED' AND start_time = ? AND end_time = ?`,
    [ROOM_ID, slot.start, slot.end]
  );
  const confirmed = rows[0].confirmed;

  console.log(`CONFIRMED reservations in the database for this room and range: ${confirmed}`);
  console.log(confirmed === 1 ? "OK - no double booking" : `PROBLEM - double booking (${confirmed} rows)`);
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());

// Integration tests: Supertest -> Express (createApp, no port) -> service -> PostgreSQL (TEST database).
const request = require("supertest");
const bcrypt = require("bcryptjs");
const config = require("../../src/config");
const db = require("../../src/db/knex");
const { createApp } = require("../../src/app");
const { createKnexUnitOfWork } = require("../../src/db/unitOfWork.knex");
const { createUsersRepository } = require("../../src/modules/auth/users.repository.knex");
const { createAuditLogRepository } = require("../../src/modules/admin/auditLog.repository.knex");

const NOW = new Date("2026-11-01T12:00:00Z");

const app = createApp({
  config,
  runInTransaction: createKnexUnitOfWork(db).runInTransaction,
  usersRepository: createUsersRepository(db),
  auditLogRepository: createAuditLogRepository(db),
  now: () => NOW
});

const PASSWORD = "password-123";

async function registerAndLogin(email) {
  await request(app).post("/api/auth/register").send({ email, password: PASSWORD }).expect(201);
  const res = await request(app).post("/api/auth/login").send({ email, password: PASSWORD }).expect(200);
  return res.body.accessToken;
}

// ADMIN cannot be created through the API - inserted directly, like the seed does
async function createAdminAndLogin(email = "admin@example.com") {
  await db("users").insert({ email, password_hash: await bcrypt.hash(PASSWORD, 10), role: "ADMIN" });
  const res = await request(app).post("/api/auth/login").send({ email, password: PASSWORD }).expect(200);
  return res.body.accessToken;
}

const auth = token => ({ Authorization: `Bearer ${token}` });

const booking = (startTime, endTime, extra = {}) => ({ roomId: 1, participants: 4, startTime, endTime, ...extra });

beforeAll(async () => {
  await db.migrate.latest();
});

beforeEach(async () => {
  await db.raw("TRUNCATE audit_log, reservations, rooms, buildings, users RESTART IDENTITY CASCADE");
  await db("buildings").insert({ name: "Budynek A", address: "ul. Testowa 1" });
  await db("rooms").insert({ building_id: 1, name: "101", capacity: 10 });
});

afterAll(async () => {
  await db.destroy();
});

describe("Auth API", () => {
  test("register + login + GET /api/auth/me", async () => {
    const register = await request(app)
      .post("/api/auth/register")
      .send({ email: "Jan.Kowalski@Example.com", password: PASSWORD });

    expect(register.status).toBe(201);
    expect(register.body).toMatchObject({ email: "jan.kowalski@example.com", role: "USER" });
    expect(register.body).not.toHaveProperty("passwordHash");

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "jan.kowalski@example.com", password: PASSWORD });

    expect(login.status).toBe(200);
    expect(login.body).toMatchObject({ tokenType: "Bearer" });

    const me = await request(app).get("/api/auth/me").set(auth(login.body.accessToken));

    expect(me.status).toBe(200);
    expect(me.body).toEqual({
      id: register.body.id,
      email: "jan.kowalski@example.com",
      role: "USER",
      createdAt: register.body.createdAt
    });
  });

  test("401 without token", async () => {
    const res = await request(app).get("/api/reservations");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });
});

describe("Reservations API", () => {
  test("POST /api/reservations -> 201, Location header and the row is in the database", async () => {
    const token = await registerAndLogin("jan@example.com");

    const res = await request(app)
      .post("/api/reservations")
      .set(auth(token))
      .send(booking("2026-11-10T10:00:00Z", "2026-11-10T11:00:00Z"));

    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/api/reservations/${res.body.id}`);
    expect(res.body).toMatchObject({ status: "CONFIRMED", user: { email: "jan@example.com" } });

    const row = await db("reservations").where({ id: res.body.id }).first();
    expect(row).toMatchObject({ room_id: 1, participants: 4, status: "CONFIRMED" });
    expect(row.start_time.toISOString()).toBe("2026-11-10T10:00:00.000Z");
  });

  test("400 with field details for an invalid body", async () => {
    const token = await registerAndLogin("jan@example.com");

    const res = await request(app)
      .post("/api/reservations")
      .set(auth(token))
      .send(booking("2026-11-10T10:00:00Z", "2026-11-10T11:00:00Z", { participants: 0 }));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details[0]).toMatchObject({ location: "body", field: "participants" });
  });

  test("404 when USER reads somebody else's reservation", async () => {
    const janToken = await registerAndLogin("jan@example.com");
    const annaToken = await registerAndLogin("anna@example.com");

    const { body: created } = await request(app)
      .post("/api/reservations")
      .set(auth(janToken))
      .send(booking("2026-11-10T10:00:00Z", "2026-11-10T11:00:00Z"))
      .expect(201);

    const res = await request(app).get(`/api/reservations/${created.id}`).set(auth(annaToken));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  test("409 ROOM_ALREADY_BOOKED for an overlapping reservation", async () => {
    const token = await registerAndLogin("jan@example.com");

    await request(app)
      .post("/api/reservations")
      .set(auth(token))
      .send(booking("2026-11-10T10:00:00Z", "2026-11-10T12:00:00Z"))
      .expect(201);

    const res = await request(app)
      .post("/api/reservations")
      .set(auth(token))
      .send(booking("2026-11-10T11:00:00Z", "2026-11-10T13:00:00Z"));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ROOM_ALREADY_BOOKED");

    const { count } = await db("reservations").count({ count: "*" }).first();
    expect(Number(count)).toBe(1);
  });

  test("pagination: meta.total and number of items for limit < number of rows", async () => {
    const token = await registerAndLogin("jan@example.com");

    for (const hour of ["08", "10", "12"]) {
      await request(app)
        .post("/api/reservations")
        .set(auth(token))
        .send(booking(`2026-11-10T${hour}:00:00Z`, `2026-11-10T${hour}:30:00Z`))
        .expect(201);
    }

    const res = await request(app).get("/api/reservations?limit=2&page=1").set(auth(token));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 2, total: 3, totalPages: 2 });
  });
});

describe("Rooms API", () => {
  test("403 when USER tries to create a room", async () => {
    const token = await registerAndLogin("jan@example.com");

    const res = await request(app).post("/api/rooms").set(auth(token)).send({ buildingId: 1, name: "999", capacity: 5 });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");

    const room = await db("rooms").where({ name: "999" }).first();
    expect(room).toBeUndefined();
  });
});

describe("Admin audit log API", () => {
  test("GET /api/admin/audit-log - ADMIN only, newest first, ?eventType filter and pagination", async () => {
    const adminToken = await createAdminAndLogin();
    const userToken = await registerAndLogin("jan@example.com");

    await db("audit_log").insert([
      { event_type: "reservation.created", payload: { reservationId: 1 }, created_at: "2026-11-01T10:00:00Z" },
      { event_type: "reservation.cancelled", payload: { reservationId: 1 }, created_at: "2026-11-01T11:00:00Z" },
      { event_type: "reservation.created", payload: { reservationId: 2 }, created_at: "2026-11-01T12:00:00Z" }
    ]);

    await request(app).get("/api/admin/audit-log").set(auth(userToken)).expect(403);

    const all = await request(app).get("/api/admin/audit-log").set(auth(adminToken));
    expect(all.status).toBe(200);
    expect(all.body.data.map(e => e.createdAt)).toEqual([
      "2026-11-01T12:00:00.000Z",
      "2026-11-01T11:00:00.000Z",
      "2026-11-01T10:00:00.000Z"
    ]);

    const filtered = await request(app)
      .get("/api/admin/audit-log?eventType=reservation.created&limit=1")
      .set(auth(adminToken));
    expect(filtered.body.meta).toMatchObject({ total: 2, limit: 1, totalPages: 2 });
    expect(filtered.body.data).toEqual([
      expect.objectContaining({ eventType: "reservation.created", payload: { reservationId: 2 } })
    ]);
  });
});

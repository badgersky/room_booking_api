// Unit tests of the reservations service: in-memory repositories + injected clock + spy event bus.
// No database is touched - these tests pass with PostgreSQL turned off.
const { createReservationsService } = require("../../src/modules/reservations/reservations.service");
const { createInMemoryUnitOfWork } = require("../../src/db/unitOfWork.memory");

const owner = { id: 1, role: "USER" };
const otherUser = { id: 2, role: "USER" };
const admin = { id: 99, role: "ADMIN" };

const NOW = new Date("2026-11-01T12:00:00Z");
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// Room 1: capacity 10, room 2: capacity 5
function setup({ reservations = [] } = {}) {
  const { runInTransaction } = createInMemoryUnitOfWork({
    users: [
      { id: owner.id, email: "owner@example.com" },
      { id: otherUser.id, email: "other@example.com" },
      { id: admin.id, email: "admin@example.com" }
    ],
    buildings: [{ id: 1, name: "Budynek A", address: "ul. Testowa 1", createdAt: NOW }],
    rooms: [
      { id: 1, buildingId: 1, name: "101", capacity: 10, createdAt: NOW },
      { id: 2, buildingId: 1, name: "102", capacity: 5, createdAt: NOW }
    ],
    reservations
  });

  // Mutable clock - lets a test move time forward between two calls
  const clock = { current: NOW };
  const eventBus = { publish: jest.fn(), subscribe: jest.fn() };
  const service = createReservationsService({ runInTransaction, eventBus, now: () => clock.current });

  return { service, eventBus, clock };
}

const at = iso => new Date(iso);

const reservation = (id, { roomId = 1, start, end, status = "CONFIRMED", userId = owner.id } = {}) => ({
  id,
  roomId,
  userId,
  participants: 2,
  startTime: at(start),
  endTime: at(end),
  status,
  createdAt: NOW,
  cancelledAt: status === "CANCELLED" ? NOW : null
});

// Existing booking used by the overlap tests: room 1, 2026-11-10 10:00-12:00
const existing = () => reservation(1, { start: "2026-11-10T10:00:00Z", end: "2026-11-10T12:00:00Z" });

const input = (start, end, { roomId = 1, participants = 2 } = {}) => ({
  roomId,
  participants,
  startTime: start,
  endTime: end
});

describe("reservationsService.createReservation - overlapping", () => {
  test.each([
    ["partial overlap at the end", "2026-11-10T11:00:00Z", "2026-11-10T13:00:00Z"],
    ["partial overlap at the start", "2026-11-10T09:00:00Z", "2026-11-10T11:00:00Z"],
    ["new range inside the existing one", "2026-11-10T10:30:00Z", "2026-11-10T11:30:00Z"],
    ["new range contains the existing one", "2026-11-10T09:00:00Z", "2026-11-10T13:00:00Z"],
    ["identical range", "2026-11-10T10:00:00Z", "2026-11-10T12:00:00Z"]
  ])("rejects %s", async (_, start, end) => {
    const { service } = setup({ reservations: [existing()] });

    await expect(service.createReservation(input(start, end), owner))
      .rejects.toMatchObject({ statusCode: 409, code: "ROOM_ALREADY_BOOKED" });
  });

  test.each([
    ["touching after (starts when the existing one ends)", "2026-11-10T12:00:00Z", "2026-11-10T13:00:00Z"],
    ["touching before (ends when the existing one starts)", "2026-11-10T09:00:00Z", "2026-11-10T10:00:00Z"]
  ])("allows %s", async (_, start, end) => {
    const { service } = setup({ reservations: [existing()] });

    await expect(service.createReservation(input(start, end), owner))
      .resolves.toMatchObject({ status: "CONFIRMED", userId: owner.id });
  });

  test("allows the same time range in another room", async () => {
    const { service } = setup({ reservations: [existing()] });

    const created = await service.createReservation(
      input("2026-11-10T10:00:00Z", "2026-11-10T12:00:00Z", { roomId: 2 }),
      owner
    );

    expect(created).toMatchObject({ roomId: 2, status: "CONFIRMED" });
  });

  test("CANCELLED reservation does not block the time range", async () => {
    const { service } = setup({
      reservations: [reservation(1, { start: "2026-11-10T10:00:00Z", end: "2026-11-10T12:00:00Z", status: "CANCELLED" })]
    });

    await expect(service.createReservation(input("2026-11-10T10:00:00Z", "2026-11-10T12:00:00Z"), owner))
      .resolves.toMatchObject({ status: "CONFIRMED" });
  });
});

describe("reservationsService.createReservation - capacity", () => {
  test("allows participants == capacity", async () => {
    const { service } = setup();

    await expect(
      service.createReservation(input("2026-11-10T10:00:00Z", "2026-11-10T11:00:00Z", { participants: 10 }), owner)
    ).resolves.toMatchObject({ participants: 10 });
  });

  test("rejects participants == capacity + 1", async () => {
    const { service } = setup();

    await expect(
      service.createReservation(input("2026-11-10T10:00:00Z", "2026-11-10T11:00:00Z", { participants: 11 }), owner)
    ).rejects.toMatchObject({ statusCode: 409, code: "ROOM_CAPACITY_EXCEEDED" });
  });
});

describe("reservationsService.createReservation - duration", () => {
  const START = "2026-11-10T08:00:00.000Z";
  const plus = ms => new Date(at(START).getTime() + ms).toISOString();

  test.each([
    ["exactly 15 min", 15 * MINUTE],
    ["exactly 8 h", 8 * HOUR]
  ])("allows %s", async (_, duration) => {
    const { service } = setup();

    await expect(service.createReservation(input(START, plus(duration)), owner))
      .resolves.toMatchObject({ status: "CONFIRMED" });
  });

  test.each([
    ["14 min", 14 * MINUTE],
    ["8 h 1 min", 8 * HOUR + MINUTE]
  ])("rejects %s", async (_, duration) => {
    const { service } = setup();

    await expect(service.createReservation(input(START, plus(duration)), owner))
      .rejects.toMatchObject({ statusCode: 400, code: "VALIDATION_ERROR" });
  });
});

describe("reservationsService.cancelReservation", () => {
  test("rejects cancelling a reservation that has already started", async () => {
    const started = reservation(1, {
      start: new Date(NOW.getTime() - HOUR).toISOString(),
      end: new Date(NOW.getTime() + HOUR).toISOString()
    });
    const { service } = setup({ reservations: [started] });

    await expect(service.cancelReservation(1, owner))
      .rejects.toMatchObject({ statusCode: 409, code: "RESERVATION_ALREADY_STARTED" });
  });

  test("double cancel is idempotent - cancelledAt does not change", async () => {
    const { service, clock } = setup({ reservations: [existing()] });

    const first = await service.cancelReservation(1, owner);
    clock.current = new Date(NOW.getTime() + 10 * MINUTE); // time moves on
    const second = await service.cancelReservation(1, owner);

    expect(first.status).toBe("CANCELLED");
    expect(second.status).toBe("CANCELLED");
    expect(second.cancelledAt).toEqual(first.cancelledAt);
    expect(second.cancelledAt).toEqual(NOW);
  });
});

describe("reservationsService - ownership", () => {
  test("another USER cannot cancel the reservation (404, existence not revealed)", async () => {
    const { service } = setup({ reservations: [existing()] });

    await expect(service.cancelReservation(1, otherUser))
      .rejects.toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
  });

  test("another USER cannot read the reservation (404)", async () => {
    const { service } = setup({ reservations: [existing()] });

    await expect(service.getReservation(1, otherUser))
      .rejects.toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
  });

  test("ADMIN can cancel somebody else's reservation", async () => {
    const { service } = setup({ reservations: [existing()] });

    await expect(service.cancelReservation(1, admin))
      .resolves.toMatchObject({ status: "CANCELLED", userId: owner.id });
  });
});

describe("reservationsService - events", () => {
  test("publishes reservation.created after a successful create", async () => {
    const { service, eventBus } = setup();

    const created = await service.createReservation(input("2026-11-10T10:00:00Z", "2026-11-10T11:00:00Z"), owner);

    expect(eventBus.publish).toHaveBeenCalledTimes(1);
    expect(eventBus.publish).toHaveBeenCalledWith("reservation.created", {
      reservationId: created.id,
      roomId: 1,
      userId: owner.id,
      startTime: "2026-11-10T10:00:00.000Z",
      endTime: "2026-11-10T11:00:00.000Z"
    });
  });

  test("does not publish anything when create fails (409)", async () => {
    const { service, eventBus } = setup({ reservations: [existing()] });

    await expect(service.createReservation(input("2026-11-10T11:00:00Z", "2026-11-10T13:00:00Z"), owner))
      .rejects.toMatchObject({ code: "ROOM_ALREADY_BOOKED" });

    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  test("publishes reservation.cancelled once - repeated cancel publishes nothing", async () => {
    const { service, eventBus } = setup({ reservations: [existing()] });

    await service.cancelReservation(1, admin);
    await service.cancelReservation(1, admin);

    expect(eventBus.publish).toHaveBeenCalledTimes(1);
    expect(eventBus.publish).toHaveBeenCalledWith("reservation.cancelled", {
      reservationId: 1,
      roomId: 1,
      userId: owner.id,
      cancelledBy: admin.id
    });
  });
});

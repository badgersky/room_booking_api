const { NotFoundError, ConflictError, ValidationError, ForbiddenError } = require("../../errors/AppError");
const { noopEventBus } = require("../../events/eventBus");

const MIN_DURATION_MS = 15 * 60 * 1000;      // 15 minutes
const MAX_DURATION_MS = 8 * 60 * 60 * 1000;  // 8 hours

const ALLOWED_TRANSITIONS = {
  CONFIRMED: ["CANCELLED"],
  CANCELLED: []
};

// Half-open intervals [start, end): touching intervals do not overlap
function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart < aEnd;
}

function canAccess(reservation, currentUser) {
  return currentUser.role === "ADMIN" || reservation.userId === currentUser.id;
}

function createReservationsService({ runInTransaction, eventBus = noopEventBus, now = () => new Date() }) {
  async function listReservations(query, currentUser) {
    let effectiveQuery = query;
    if (currentUser.role !== "ADMIN") {
      if (query.userId !== undefined) {
        throw new ForbiddenError("Filtering by userId is allowed only for ADMIN");
      }
      effectiveQuery = { ...query, userId: currentUser.id };
    }

    return runInTransaction(async ({ reservations }) => {
      const { items, total } = await reservations.list(effectiveQuery);
      return {
        items,
        meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) }
      };
    });
  }

  async function getReservation(id, currentUser) {
    return runInTransaction(async ({ reservations }) => {
      const reservation = await reservations.findById(id);
      if (!reservation || !canAccess(reservation, currentUser)) throw new NotFoundError("Reservation");
      return reservation;
    });
  }

  async function createReservation(input, currentUser) {
    const start = new Date(input.startTime).getTime();
    const end = new Date(input.endTime).getTime();
    const currentTime = now().getTime();

    // 400 - time rules
    const details = [];

    if (end <= start) {
      details.push({ location: "body", field: "endTime", message: "endTime must be later than startTime" });
    } else {
      const duration = end - start;
      if (duration < MIN_DURATION_MS) {
        details.push({ location: "body", field: "endTime", message: "Reservation must last at least 15 minutes" });
      } else if (duration > MAX_DURATION_MS) {
        details.push({ location: "body", field: "endTime", message: "Reservation must last at most 8 hours" });
      }
    }

    if (start <= currentTime) {
      details.push({ location: "body", field: "startTime", message: "startTime must be in the future" });
    }

    if (details.length > 0) throw new ValidationError(details);

    const created = await runInTransaction(async ({ rooms, reservations }) => {
      // 404 - room must exist
      const room = await rooms.findById(input.roomId);
      if (!room) throw new NotFoundError("Room");

      // 409 - capacity
      if (input.participants > room.capacity) {
        throw new ConflictError("Room capacity exceeded", "ROOM_CAPACITY_EXCEEDED");
      }

      await rooms.lockById(room.id);

      // 409 - overlapping
      const active = await reservations.findConfirmedByRoom(room.id);
      const collision = active.some(r =>
        overlaps(start, end, new Date(r.startTime).getTime(), new Date(r.endTime).getTime())
      );

      if (collision) {
        throw new ConflictError("Room is already booked in this time range", "ROOM_ALREADY_BOOKED");
      }

      return reservations.create({
        roomId: room.id,
        userId: currentUser.id,
        participants: input.participants,
        startTime: new Date(start),
        endTime: new Date(end),
        status: "CONFIRMED",
        createdAt: now(),
        cancelledAt: null,
        internalNote: "created via API v2"
      });
    });

    // Published only after COMMIT: if the transaction failed (400/404/409) we never get here
    eventBus.publish("reservation.created", {
      reservationId: created.id,
      roomId: created.roomId,
      userId: created.userId,
      startTime: new Date(created.startTime).toISOString(),
      endTime: new Date(created.endTime).toISOString()
    });

    return created;
  }

  async function cancelReservation(id, currentUser) {
    let changed = false;

    const result = await runInTransaction(async ({ reservations }) => {
      const reservation = await reservations.findById(id);
      if (!reservation || !canAccess(reservation, currentUser)) throw new NotFoundError("Reservation");

      if (reservation.status === "CANCELLED") return reservation;

      if (!ALLOWED_TRANSITIONS[reservation.status].includes("CANCELLED")) {
        throw new ConflictError(
          `Cannot change status from ${reservation.status} to CANCELLED`,
          "INVALID_STATUS_TRANSITION"
        );
      }

      if (new Date(reservation.startTime).getTime() <= now().getTime()) {
        throw new ConflictError("Reservation has already started", "RESERVATION_ALREADY_STARTED");
      }

      changed = true;
      return reservations.markCancelled(id, now());
    });

    // After COMMIT, and only when the status really changed - an idempotent repeated cancel publishes nothing
    if (changed) {
      eventBus.publish("reservation.cancelled", {
        reservationId: result.id,
        roomId: result.roomId,
        userId: result.userId,
        cancelledBy: currentUser.id
      });
    }

    return result;
  }

  return { listReservations, getReservation, createReservation, cancelReservation };
}

module.exports = { createReservationsService };

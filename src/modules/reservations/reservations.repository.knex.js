// The only place that knows table and column names of "reservations"

// Whitelist: the API sort value -> column. Column names go into the SQL text (they cannot be bound
// parameters), so the client never gets to pass its own fragment - see material 03, section 8.
const SORT_COLUMNS = {
  startTime: "res.start_time",
  createdAt: "res.created_at",
  participants: "res.participants"
};

const DETAIL_COLUMNS = [
  "res.id",
  "res.room_id",
  "res.user_id",
  "res.participants",
  "res.start_time",
  "res.end_time",
  "res.status",
  "res.cancelled_at",
  "res.created_at",
  "r.name as room_name",
  "r.building_id",
  "b.name as building_name",
  "u.email as user_email"
];

function toReservation(row) {
  if (!row) return null;
  return {
    id: row.id,
    roomId: row.room_id,
    room: {
      id: row.room_id,
      name: row.room_name,
      building: { id: row.building_id, name: row.building_name }
    },
    userId: row.user_id,
    user: { id: row.user_id, email: row.user_email },
    participants: row.participants,
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status,
    createdAt: row.created_at,
    cancelledAt: row.cancelled_at
  };
}

// Without room/building - used by the collision check, which does not need them
function toFlatReservation(row) {
  return {
    id: row.id,
    roomId: row.room_id,
    userId: row.user_id,
    participants: row.participants,
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status,
    createdAt: row.created_at,
    cancelledAt: row.cancelled_at
  };
}

function createReservationsKnexRepository(db) {
  const withRoomAndBuilding = () =>
    db("reservations as res")
      .join("rooms as r", "r.id", "res.room_id")
      .join("buildings as b", "b.id", "r.building_id")
      .join("users as u", "u.id", "res.user_id");

  async function findById(id) {
    return toReservation(await withRoomAndBuilding().select(DETAIL_COLUMNS).where("res.id", id).first());
  }

  return {
    findById,

    async findConfirmedByRoom(roomId) {
      const rows = await db("reservations").where({ room_id: roomId, status: "CONFIRMED" });
      return rows.map(toFlatReservation);
    },

    // Filtering, sorting and pagination all happen in the database: WHERE / ORDER BY / LIMIT / OFFSET.
    // Always exactly 2 queries (page + total), no matter how many rows are returned.
    async list({ roomId, buildingId, userId, status, from, to, page, limit, sort }) {
      const base = withRoomAndBuilding().modify(qb => {
        if (roomId !== undefined) qb.where("res.room_id", roomId);
        if (buildingId !== undefined) qb.where("r.building_id", buildingId);
        if (userId !== undefined) qb.where("res.user_id", userId);
        // Overlap with the half-open range [from, to): reservation.start < to AND reservation.end > from.
        // Touching ranges do not overlap, same rule as for booking collisions.
        if (from !== undefined) qb.where("res.end_time", ">", from);
        if (to !== undefined) qb.where("res.start_time", "<", to);
      });

      const desc = sort.startsWith("-");
      const column = SORT_COLUMNS[desc ? sort.slice(1) : sort];

      const rows = await base
        .clone()
        .select(DETAIL_COLUMNS)
        .orderBy(column, desc ? "desc" : "asc")
        .orderBy("res.id", "asc") // tie-breaker: stable order between pages
        .limit(limit)
        .offset((page - 1) * limit);

      const { count } = await base.clone().count({ count: "*" }).first();

      return { items: rows.map(toReservation), total: Number(count) };
    },

    async create({ roomId, userId, participants, startTime, endTime, status, createdAt, cancelledAt }) {
      const [{ id }] = await db("reservations")
        .insert({
          room_id: roomId,
          user_id: userId,
          participants,
          start_time: startTime,
          end_time: endTime,
          status,
          created_at: createdAt,
          cancelled_at: cancelledAt
        })
        .returning("id");
      return findById(id);
    },

    async markCancelled(id, cancelledAt) {
      await db("reservations").where({ id }).update({ status: "CANCELLED", cancelled_at: cancelledAt });
      return findById(id);
    }
  };
}

module.exports = { createReservationsKnexRepository };

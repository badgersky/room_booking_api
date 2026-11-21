const { createSeedData } = require("../seedData");

// Development / demo data only. Never run a seed with TRUNCATE on production.
exports.seed = async function (knex) {
  // TRUNCATE ... RESTART IDENTITY: running the seed many times always gives the same state, with ids starting at 1
  await knex.raw("TRUNCATE reservations, rooms, buildings RESTART IDENTITY CASCADE");

  const data = createSeedData();

  // Rows are inserted without explicit ids so the sequences advance - the next POST must not get id 1 again.
  // Insertion order = id order, which matches the ids used to describe relations in seedData.js.
  await knex("buildings").insert(
    data.buildings.map(b => ({ name: b.name, address: b.address, created_at: b.createdAt }))
  );

  await knex("rooms").insert(
    data.rooms.map(r => ({ building_id: r.buildingId, name: r.name, capacity: r.capacity, created_at: r.createdAt }))
  );

  await knex("reservations").insert(
    data.reservations.map(r => ({
      room_id: r.roomId,
      user_id: r.userId,
      participants: r.participants,
      start_time: r.startTime,
      end_time: r.endTime,
      status: r.status,
      cancelled_at: r.cancelledAt,
      created_at: r.createdAt
    }))
  );
};

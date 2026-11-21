// The only place that knows table and column names of "buildings" (snake_case <-> camelCase mapping lives here)
function toBuilding(row) {
  if (!row) return null;

  const building = {
    id: row.id,
    name: row.name,
    address: row.address,
    createdAt: row.created_at
  };

  // COUNT(*) is bigint -> the pg driver returns it as a string, so convert explicitly
  if (row.rooms_count !== undefined) building.roomsCount = Number(row.rooms_count);

  return building;
}

function createBuildingsKnexRepository(db) {
  return {
    // One query for all buildings. LEFT JOIN keeps buildings without rooms (INNER JOIN would drop them).
    async findAll() {
      const rows = await db("buildings as b")
        .leftJoin("rooms as r", "r.building_id", "b.id")
        .select("b.id", "b.name", "b.address", "b.created_at")
        .count({ rooms_count: "r.id" }) // counts non-NULL room ids -> 0 for an empty building
        .groupBy("b.id")
        .orderBy("b.id", "asc");
      return rows.map(toBuilding);
    },

    async findById(id) {
      return toBuilding(await db("buildings").where({ id }).first());
    },

    async create({ name, address }) {
      const [row] = await db("buildings").insert({ name, address }).returning("*");
      return toBuilding(row);
    }
  };
}

module.exports = { createBuildingsKnexRepository };

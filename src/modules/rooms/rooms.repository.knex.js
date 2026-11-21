// The only place that knows table and column names of "rooms"
const ROOM_COLUMNS = [
  "r.id",
  "r.name",
  "r.capacity",
  "r.building_id",
  "r.created_at",
  "b.name as building_name"
];

function toRoom(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    capacity: row.capacity,
    buildingId: row.building_id,
    createdAt: row.created_at,
    building: { id: row.building_id, name: row.building_name }
  };
}

function createRoomsKnexRepository(db) {
  // Every read joins the building in the same query - no N+1
  const roomsWithBuilding = () =>
    db("rooms as r").join("buildings as b", "b.id", "r.building_id").select(ROOM_COLUMNS);

  async function findById(id) {
    return toRoom(await roomsWithBuilding().where("r.id", id).first());
  }

  return {
    findById,

    async findAll() {
      const rows = await roomsWithBuilding().orderBy("r.id", "asc");
      return rows.map(toRoom);
    },

    async findByBuildingId(buildingId) {
      const rows = await roomsWithBuilding().where("r.building_id", buildingId).orderBy("r.id", "asc");
      return rows.map(toRoom);
    },

    async create({ buildingId, name, capacity }) {
      const [{ id }] = await db("rooms")
        .insert({ building_id: buildingId, name, capacity })
        .returning("id");
      return findById(id);
    },

    // SELECT id FROM rooms WHERE id = ? FOR UPDATE - row lock held until the end of the transaction
    async lockById(id) {
      await db("rooms").select("id").where({ id }).forUpdate().first();
    }
  };
}

module.exports = { createRoomsKnexRepository };

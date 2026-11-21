const { ConflictError } = require("../../errors/AppError");

// Same interface as rooms.repository.knex.js. `store` is shared with the other in-memory repositories.
function createInMemoryRoomsRepository(store) {
  let nextId = Math.max(0, ...store.rooms.map(r => r.id)) + 1;

  const withBuilding = room => {
    const building = store.buildings.find(b => b.id === room.buildingId);
    return { ...room, building: { id: building.id, name: building.name } };
  };

  return {
    async findAll() {
      return store.rooms.map(withBuilding);
    },

    async findById(id) {
      const room = store.rooms.find(r => r.id === id);
      return room ? withBuilding(room) : null;
    },

    async findByBuildingId(buildingId) {
      return store.rooms.filter(r => r.buildingId === buildingId).map(withBuilding);
    },

    async create({ buildingId, name, capacity }) {
      // Emulates UNIQUE (building_id, name)
      if (store.rooms.some(r => r.buildingId === buildingId && r.name === name)) {
        throw new ConflictError("Resource already exists", "UNIQUE_VIOLATION");
      }
      const room = { id: nextId++, buildingId, name, capacity, createdAt: new Date() };
      store.rooms.push(room);
      return withBuilding(room);
    },

    // In memory there is nothing to lock (no concurrent transactions) - kept so the interface is identical
    async lockById() {}
  };
}

module.exports = { createInMemoryRoomsRepository };

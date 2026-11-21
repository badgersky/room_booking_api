const { ConflictError } = require("../../errors/AppError");

// Same interface as buildings.repository.knex.js. `store` is shared with the other in-memory repositories.
function createInMemoryBuildingsRepository(store) {
  let nextId = Math.max(0, ...store.buildings.map(b => b.id)) + 1;

  return {
    async findAll() {
      return store.buildings.map(b => ({
        ...b,
        roomsCount: store.rooms.filter(r => r.buildingId === b.id).length
      }));
    },

    async findById(id) {
      const building = store.buildings.find(b => b.id === id);
      return building ? { ...building } : null;
    },

    async create({ name, address }) {
      // Emulates the UNIQUE constraint on buildings.name (same error as the PostgreSQL 23505 mapping)
      if (store.buildings.some(b => b.name === name)) {
        throw new ConflictError("Resource already exists", "UNIQUE_VIOLATION");
      }
      const building = { id: nextId++, name, address, createdAt: new Date() };
      store.buildings.push(building);
      return { ...building };
    }
  };
}

module.exports = { createInMemoryBuildingsRepository };

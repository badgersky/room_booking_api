const { createSeedData } = require("./seedData");
const { createInMemoryBuildingsRepository } = require("../modules/buildings/buildings.repository.memory");
const { createInMemoryRoomsRepository } = require("../modules/rooms/rooms.repository.memory");
const { createInMemoryReservationsRepository } = require("../modules/reservations/reservations.repository.memory");

function createInMemoryUnitOfWork(seed = createSeedData()) {
  // One shared "database" for all in-memory repositories (reservations need rooms and buildings to join)
  const store = structuredClone(seed);

  const repositories = {
    buildings: createInMemoryBuildingsRepository(store),
    rooms: createInMemoryRoomsRepository(store),
    reservations: createInMemoryReservationsRepository(store)
  };

  // Nothing to roll back in memory - just call the function
  return { repositories, runInTransaction: fn => fn(repositories) };
}

module.exports = { createInMemoryUnitOfWork };

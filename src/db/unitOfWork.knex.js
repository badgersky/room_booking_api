const { createBuildingsKnexRepository } = require("../modules/buildings/buildings.repository.knex");
const { createRoomsKnexRepository } = require("../modules/rooms/rooms.repository.knex");
const { createReservationsKnexRepository } = require("../modules/reservations/reservations.repository.knex");

// All repositories bound to the same query runner: the pool (db) or one transaction (trx).
// Inside a transaction every query MUST go through trx, otherwise it runs on another connection, outside of it.
function createKnexRepositories(db) {
  return {
    buildings: createBuildingsKnexRepository(db),
    rooms: createRoomsKnexRepository(db),
    reservations: createReservationsKnexRepository(db)
  };
}

// Unit of Work: services never see Knex, they only get repositories that belong to one transaction.
function createKnexUnitOfWork(db) {
  return {
    repositories: createKnexRepositories(db),
    runInTransaction: fn => db.transaction(trx => fn(createKnexRepositories(trx)))
  };
}

module.exports = { createKnexRepositories, createKnexUnitOfWork };

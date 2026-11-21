// One source of sample data for both implementations:
//  - src/db/seeds/01_demo_data.js (PostgreSQL)
//  - src/db/unitOfWork.memory.js  (in-memory)
// Ids are only used to describe relations here; PostgreSQL assigns the real ones (1, 2, 3...) in insertion order
// after TRUNCATE ... RESTART IDENTITY.
const HOUR = 60 * 60 * 1000;

function createSeedData(nowMs = Date.now()) {
  const createdAt = new Date(nowMs - 72 * HOUR);

  return {
    users: [
      { id: 1, email: "admin@example.com" },
      { id: 2, email: "anna.nowak@example.com" },
      { id: 3, email: "piotr.zielinski@example.com" }
    ],

    buildings: [
      { id: 1, name: "Budynek A", address: "ul. Warszawska 24, Kraków", createdAt },
      { id: 2, name: "Budynek B", address: "ul. Floriańska 10, Kraków", createdAt },
      { id: 3, name: "Budynek C", address: "ul. Długa 5, Kraków", createdAt } // no rooms - roomsCount: 0
    ],

    rooms: [
      { id: 1, buildingId: 1, name: "101", capacity: 30, createdAt },
      { id: 2, buildingId: 1, name: "102", capacity: 10, createdAt },
      { id: 3, buildingId: 1, name: "Sala konferencyjna", capacity: 12, createdAt },
      { id: 4, buildingId: 2, name: "101", capacity: 20, createdAt }, // same name as in building A - allowed
      { id: 5, buildingId: 2, name: "201", capacity: 8, createdAt }
    ],

    reservations: [
      // id 1: already started (began 1h ago, ends in 1h) - for RESERVATION_ALREADY_STARTED
      {
        id: 1, roomId: 1, userId: 1, participants: 5,
        startTime: new Date(nowMs - HOUR), endTime: new Date(nowMs + HOUR),
        status: "CONFIRMED", createdAt: new Date(nowMs - 24 * HOUR), cancelledAt: null
      },
      // id 2: future CONFIRMED reservation in room 1 - for overlap tests
      {
        id: 2, roomId: 1, userId: 2, participants: 4,
        startTime: new Date("2027-03-10T10:00:00.000Z"), endTime: new Date("2027-03-10T12:00:00.000Z"),
        status: "CONFIRMED", createdAt: new Date(nowMs - 24 * HOUR), cancelledAt: null
      },
      // id 3: CANCELLED reservation in room 2 - must not block the room
      {
        id: 3, roomId: 2, userId: 2, participants: 2,
        startTime: new Date("2027-03-10T10:00:00.000Z"), endTime: new Date("2027-03-10T12:00:00.000Z"),
        status: "CANCELLED", createdAt: new Date(nowMs - 48 * HOUR), cancelledAt: new Date(nowMs - 24 * HOUR)
      },
      // id 4, 5: more future data (other rooms, other buildings)
      {
        id: 4, roomId: 3, userId: 3, participants: 8,
        startTime: new Date("2027-03-11T09:00:00.000Z"), endTime: new Date("2027-03-11T11:00:00.000Z"),
        status: "CONFIRMED", createdAt: new Date(nowMs - 12 * HOUR), cancelledAt: null
      },
      {
        id: 5, roomId: 4, userId: 3, participants: 15,
        startTime: new Date("2027-03-12T14:00:00.000Z"), endTime: new Date("2027-03-12T16:00:00.000Z"),
        status: "CONFIRMED", createdAt: new Date(nowMs - 6 * HOUR), cancelledAt: null
      }
    ]
  };
}

module.exports = { createSeedData };

// Same interface as reservations.repository.knex.js. `store` is shared with the other in-memory repositories.
// Unlike the Knex version, filtering/sorting/pagination here is plain JavaScript - there is no database.
const SORT_FIELDS = ["startTime", "createdAt", "participants"];

function createInMemoryReservationsRepository(store) {
  let nextId = Math.max(0, ...store.reservations.map(r => r.id)) + 1;

  const withRoom = reservation => {
    const room = store.rooms.find(r => r.id === reservation.roomId);
    const building = store.buildings.find(b => b.id === room.buildingId);
    const user = store.users.find(u => u.id === reservation.userId);
    return {
      ...reservation,
      user: { id: user.id, email: user.email },
      room: { id: room.id, name: room.name, building: { id: building.id, name: building.name } }
    };
  };

  return {
    async findById(id) {
      const reservation = store.reservations.find(r => r.id === id);
      return reservation ? withRoom(reservation) : null;
    },

    async findConfirmedByRoom(roomId) {
      return store.reservations.filter(r => r.roomId === roomId && r.status === "CONFIRMED");
    },

    async list({ roomId, buildingId, status, from, to, page = 1, limit = 20, sort = "startTime" } = {}) {
      const fromMs = from === undefined ? undefined : new Date(from).getTime();
      const toMs = to === undefined ? undefined : new Date(to).getTime();

      const filtered = store.reservations.filter(r => {
        if (roomId !== undefined && r.roomId !== roomId) return false;
        if (buildingId !== undefined) {
          const room = store.rooms.find(x => x.id === r.roomId);
          if (room.buildingId !== buildingId) return false;
        }
        if (status !== undefined && r.status !== status) return false;
        if (fromMs !== undefined && !(new Date(r.endTime).getTime() > fromMs)) return false;
        if (toMs !== undefined && !(new Date(r.startTime).getTime() < toMs)) return false;
        return true;
      });

      const desc = sort.startsWith("-");
      const field = desc ? sort.slice(1) : sort;
      if (!SORT_FIELDS.includes(field)) throw new Error(`Unsupported sort: ${sort}`);

      filtered.sort((a, b) => {
        const diff = new Date(a[field]).getTime() - new Date(b[field]).getTime();
        const byField = field === "participants" ? a.participants - b.participants : diff;
        return (desc ? -byField : byField) || a.id - b.id; // tie-breaker by id
      });

      const items = filtered.slice((page - 1) * limit, page * limit).map(withRoom);
      return { items, total: filtered.length };
    },

    async create(data) {
      const { internalNote, ...columns } = data; // not a column in the database schema either
      const reservation = { id: nextId++, ...columns };
      store.reservations.push(reservation);
      return withRoom(reservation);
    },

    async markCancelled(id, cancelledAt) {
      const reservation = store.reservations.find(r => r.id === id);
      reservation.status = "CANCELLED";
      reservation.cancelledAt = cancelledAt;
      return withRoom(reservation);
    }
  };
}

module.exports = { createInMemoryReservationsRepository };

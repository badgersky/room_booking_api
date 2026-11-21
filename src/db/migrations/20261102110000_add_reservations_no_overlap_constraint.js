// Database-level guarantee: a room cannot have two overlapping CONFIRMED reservations.
// Works regardless of how many API instances run and whether the application remembered to lock anything.
exports.up = async function (knex) {
  // btree_gist lets a GiST index handle plain equality (room_id WITH =) next to range overlap (&&)
  await knex.raw(`CREATE EXTENSION IF NOT EXISTS btree_gist`);

  await knex.raw(`
    ALTER TABLE reservations ADD CONSTRAINT reservations_no_overlap
      EXCLUDE USING gist (
        room_id WITH =,
        tstzrange(start_time, end_time, '[)') WITH &&
      ) WHERE (status = 'CONFIRMED')
  `);
};

exports.down = async function (knex) {
  await knex.raw(`ALTER TABLE reservations DROP CONSTRAINT reservations_no_overlap`);
  // The extension is intentionally left installed - other objects may rely on it.
};

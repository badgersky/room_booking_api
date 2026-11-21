exports.up = async function (knex) {
  await knex.schema.alterTable("reservations", table => {
    table.integer("user_id").references("id").inTable("users").onDelete("RESTRICT");
  });

// finds user id by finding matching names and last names with email 
  await knex.raw(`
    UPDATE reservations r
       SET user_id = u.id
      FROM users u
     WHERE r.user_id IS NULL
       AND replace(
             translate(lower(r.reserved_by), 'ąćęłńóśźż', 'acelnoszz'),
             ' ', '.'
           ) = split_part(u.email, '@', 1)
  `);

  // whatever is left goes to admin
  const { rows: orphans } = await knex.raw("SELECT count(*)::int AS n FROM reservations WHERE user_id IS NULL");
  if (orphans[0].n > 0) {
    const admin = await knex("users").where({ role: "ADMIN" }).orderBy("id").first();
    if (!admin) {
      throw new Error(
        `${orphans[0].n} reservations have no matching user and there is no ADMIN to take them over. ` +
          "Run the users seed (npm run seed:run) or create a user first."
      );
    }
    await knex("reservations").whereNull("user_id").update({ user_id: admin.id });
  }

  await knex.raw("ALTER TABLE reservations ALTER COLUMN user_id SET NOT NULL");

  await knex.schema.alterTable("reservations", table => {
    table.index("user_id", "reservations_user_id_idx");
    table.dropColumn("reserved_by");
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable("reservations", table => {
    table.string("reserved_by", 100);
  });

  await knex.raw("UPDATE reservations r SET reserved_by = LEFT(u.email, 100) FROM users u WHERE u.id = r.user_id");
  await knex.raw("ALTER TABLE reservations ALTER COLUMN reserved_by SET NOT NULL");

  await knex.schema.alterTable("reservations", table => {
    table.dropIndex("user_id", "reservations_user_id_idx");
    table.dropColumn("user_id");
  });
};
exports.up = knex => knex.schema.createTable("audit_log", table => {
  table.bigIncrements("id").primary();
  table.string("event_type", 100).notNullable();
  table.jsonb("payload").notNullable();
  table.timestamp("created_at", { useTz: true }).notNullable();
  table.index(["event_type", "created_at"], "audit_log_event_type_created_at_idx");
});

exports.down = knex => knex.schema.dropTable("audit_log");

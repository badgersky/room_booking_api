const config = require("./src/config");

module.exports = {
  client: "pg",
  connection: config.DATABASE_URL,
  pool: { min: 2, max: 10 },
  migrations: { directory: "./src/db/migrations" },
  seeds: { directory: "./src/db/seeds" }
};
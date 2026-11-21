const knex = require("knex");
const config = require("../../knexfile");

// Created once for the whole application - knex() builds a connection pool (see material 03, "Connection pool")
module.exports = knex(config);

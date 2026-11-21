const { z } = require("zod");

// PostgreSQL "integer" is 32-bit. Without an upper bound, id=99999999999 would reach the database and end in a 500.
const MAX_INT = 2147483647;

const positiveInt = z.coerce.number().int().positive().max(MAX_INT);
const idParams = z.object({ id: positiveInt });

module.exports = { MAX_INT, positiveInt, idParams };

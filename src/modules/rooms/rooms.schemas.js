const { z } = require("zod");
const { MAX_INT, idParams } = require("../common.schemas");

const createRoomBody = z.object({
  buildingId: z.number().int().positive().max(MAX_INT),
  name: z.string().trim().min(1).max(100),
  capacity: z.number().int().positive().max(MAX_INT)
}).strict();

module.exports = { idParams, createRoomBody };

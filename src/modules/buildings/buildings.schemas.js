const { z } = require("zod");
const { idParams } = require("../common.schemas");

const createBuildingBody = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().min(1).max(255)
}).strict();

module.exports = { idParams, createBuildingBody };

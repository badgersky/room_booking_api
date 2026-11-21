const { z } = require("zod");
const { MAX_INT, positiveInt, idParams } = require("../common.schemas");

const createReservationBody = z.object({
  roomId: z.number().int().positive().max(MAX_INT),
  participants: z.number().int().positive(),
  startTime: z.iso.datetime({ offset: true }),
  endTime: z.iso.datetime({ offset: true })
}).strict();

// Upper bound keeps (page - 1) * limit far below the bigint range of OFFSET
const MAX_PAGE = Math.floor(Number.MAX_SAFE_INTEGER / 100);

// Whitelist of sort values (prefix "-" = descending). Anything else -> 400.
const SORT_VALUES = ["startTime", "-startTime", "createdAt", "-createdAt", "participants", "-participants"];

const listReservationsQuery = z.object({
  roomId: positiveInt.optional(),
  buildingId: positiveInt.optional(),
  userId: positiveInt.optional(),
  status: z.enum(["CONFIRMED", "CANCELLED"]).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).max(MAX_PAGE).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(SORT_VALUES).default("startTime")
}).refine(
  query => !query.from || !query.to || new Date(query.from) < new Date(query.to),
  { path: ["to"], message: "to must be later than from" }
);

module.exports = { idParams, createReservationBody, listReservationsQuery };

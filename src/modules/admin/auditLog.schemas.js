const { z } = require("zod");

const MAX_PAGE = Math.floor(Number.MAX_SAFE_INTEGER / 100);

const listAuditLogQuery = z.object({
  eventType: z.string().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).max(MAX_PAGE).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
}).strict();

module.exports = { listAuditLogQuery };

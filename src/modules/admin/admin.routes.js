const { Router } = require("express");
const validate = require("../../middleware/validate");
const authorize = require("../../middleware/authorize");
const { listAuditLogQuery } = require("./auditLog.schemas");

const toAuditLogResponse = entry => ({
  id: entry.id,
  eventType: entry.eventType,
  payload: entry.payload,
  createdAt: new Date(entry.createdAt).toISOString()
});

// Mounted under /api/admin, behind authenticate. Every route here is ADMIN only.
function createAdminRouter({ auditLogRepository }) {
  const router = Router();

  router.use(authorize("ADMIN"));

  router.get("/audit-log", validate({ query: listAuditLogQuery }), async (req, res) => {
    const query = req.validated.query;
    const { items, total } = await auditLogRepository.list(query);
    res.json({
      data: items.map(toAuditLogResponse),
      meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) }
    });
  });

  return router;
}

module.exports = { createAdminRouter };

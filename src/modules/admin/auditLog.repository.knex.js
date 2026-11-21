// The only place that knows table and column names of "audit_log"
function toAuditLogEntry(row) {
  return {
    id: Number(row.id), // bigIncrements -> pg returns bigint as string
    eventType: row.event_type,
    payload: row.payload,
    createdAt: row.created_at
  };
}

function createAuditLogRepository(db) {
  return {
    // Newest first; id as tie-breaker. 2 queries: page + total.
    async list({ eventType, page, limit }) {
      const base = db("audit_log").modify(qb => {
        if (eventType !== undefined) qb.where("event_type", eventType);
      });

      const rows = await base
        .clone()
        .select("id", "event_type", "payload", "created_at")
        .orderBy("created_at", "desc")
        .orderBy("id", "desc")
        .limit(limit)
        .offset((page - 1) * limit);

      const { count } = await base.clone().count({ count: "*" }).first();

      return { items: rows.map(toAuditLogEntry), total: Number(count) };
    }
  };
}

module.exports = { createAuditLogRepository };

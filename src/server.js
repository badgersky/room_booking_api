const config = require("./config");
const { createApp } = require("./app");
const { createEventBus } = require("./events/eventBus");

// Composition root: the only place that picks the storage implementation and starts the server.
//   STORAGE=knex   (default) - PostgreSQL via Knex
//   STORAGE=memory           - in-memory repositories (data is lost on restart)
async function main() {
  let runInTransaction;
  let usersRepository;
  let auditLogRepository;
  let closeStorage = async () => {};

  const eventBus = createEventBus();

  if (config.STORAGE === "knex") {
    const db = require("./db/knex");
    const { createKnexUnitOfWork } = require("./db/unitOfWork.knex");
    const { createUsersRepository } = require("./modules/auth/users.repository.knex");
    const { createAuditLogRepository } = require("./modules/admin/auditLog.repository.knex");
    const { registerAuditListeners } = require("./events/auditListeners");
    const { registerNotificationListeners } = require("./events/notificationListeners");

    await db.raw("select 1");
    console.log("Connected to PostgreSQL");

    ({ runInTransaction } = createKnexUnitOfWork(db));
    usersRepository = createUsersRepository(db);
    auditLogRepository = createAuditLogRepository(db);

    registerAuditListeners(eventBus, db);
    registerNotificationListeners(eventBus, usersRepository);

    closeStorage = () => db.destroy();
  } else {
    const { createInMemoryUnitOfWork } = require("./db/unitOfWork.memory");
    ({ runInTransaction } = createInMemoryUnitOfWork());
    console.log("Using in-memory storage - data will be lost on restart");
  }

  const app = createApp({ config, runInTransaction, usersRepository, auditLogRepository, eventBus });

  const server = app.listen(config.PORT, () => {
    console.log(`Server running on http://localhost:${config.PORT}`);
  });

  // Graceful shutdown: docker compose down sends SIGTERM, Ctrl+C sends SIGINT.
  // server.close() stops accepting new connections and waits for running requests, then the pool is closed.
  async function shutdown(signal) {
    console.log(`${signal} received, shutting down`);
    server.close(async () => {
      await closeStorage();
      console.log("HTTP server and database pool closed");
      process.exit(0);
    });
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch(err => {
  console.error("Failed to start:", err.message);
  process.exit(1);
});

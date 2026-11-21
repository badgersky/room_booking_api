const config = require("./config");
const { createApp } = require("./app");

// Composition root: the only place that picks the storage implementation and starts the server.
//   STORAGE=knex   (default) - PostgreSQL via Knex
//   STORAGE=memory           - in-memory repositories (data is lost on restart)
async function main() {
  let runInTransaction;
  let usersRepository;
  let closeStorage = async () => {};

  if (config.STORAGE === "knex") {
    const db = require("./db/knex");
    const { createKnexUnitOfWork } = require("./db/unitOfWork.knex");
    const { createUsersRepository } = require("./modules/auth/users.repository.knex");

    await db.raw("select 1");
    console.log("Connected to PostgreSQL");

    ({ runInTransaction } = createKnexUnitOfWork(db));
    usersRepository = createUsersRepository(db);
    closeStorage = () => db.destroy();
  } else {
    const { createInMemoryUnitOfWork } = require("./db/unitOfWork.memory");
    ({ runInTransaction } = createInMemoryUnitOfWork());
    console.log("Using in-memory storage - data will be lost on restart");
  }

  const app = createApp({ config, runInTransaction, usersRepository });
  const server = app.listen(config.PORT, () => console.log(`Server running on http://localhost:${config.PORT}`));

  const shutdown = () => server.close(() => closeStorage().finally(() => process.exit(0)));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch(err => {
  console.error("Failed to start:", err.message);
  process.exit(1);
});
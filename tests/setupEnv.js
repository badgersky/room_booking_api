// Runs before every test file, before any module reads the configuration.
// process.loadEnvFile() in src/config does not override variables that are already set,
// so tests always get the TEST database, never the development one from .env.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/room_booking_test";
process.env.JWT_SECRET = "test-secret-test-secret-test-secret-123";

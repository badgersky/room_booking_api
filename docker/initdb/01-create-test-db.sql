-- Runs only on the first start of the db container (empty pgdata volume).
-- Separate database for integration tests (npm run test:integration) - never the development one.
CREATE DATABASE room_booking_test;

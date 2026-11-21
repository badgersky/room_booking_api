const bcrypt = require("bcryptjs");

const BCRYPT_ROUNDS = 12;

// Development / demo accounts only. Admin accounts cannot be created through the API.
const USERS = [
  { email: "admin@example.com", password: "admin-password-123", role: "ADMIN" },
  { email: "anna.nowak@example.com", password: "anna-password-123", role: "USER" },
  { email: "piotr.zielinski@example.com", password: "piotr-password-123", role: "USER" }
];

exports.seed = async function (knex) {
  // Must stay the first seed: it clears users and (via CASCADE) every table that references them
  await knex.raw("TRUNCATE users RESTART IDENTITY CASCADE");

  const rows = await Promise.all(
    USERS.map(async user => ({
      email: user.email,
      password_hash: await bcrypt.hash(user.password, BCRYPT_ROUNDS),
      role: user.role
    }))
  );

  // One insert, in array order -> ids 1 (admin), 2 (anna), 3 (piotr) after every seed:run
  await knex("users").insert(rows);
};
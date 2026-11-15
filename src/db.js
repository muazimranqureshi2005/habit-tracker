// Postgres access. Same code runs locally and on Vercel; only DATABASE_URL changes.
//   - normal use:  a pg Pool connected to DATABASE_URL (Neon)
//   - automated tests (NODE_ENV=test, no DATABASE_URL): an in-memory Postgres (PGlite)
// Tables are prefixed "tally_" so they can never clash with tables from other projects in the same database.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tally_users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tally_users_email_key ON tally_users (lower(email));

CREATE TABLE IF NOT EXISTS tally_habits (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES tally_users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  frequency   TEXT NOT NULL CHECK (frequency IN ('daily','weekdays','custom')),
  custom_days TEXT NOT NULL DEFAULT '',   -- e.g. '1,3,5' (0 = Sunday ... 6 = Saturday)
  start_date  TEXT NOT NULL,              -- YYYY-MM-DD; streaks never look before this
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tally_habits_user_idx ON tally_habits (user_id);

-- One row = "this habit was done on this day". UNIQUE keeps it to one entry per habit per day.
CREATE TABLE IF NOT EXISTS tally_completions (
  id           SERIAL PRIMARY KEY,
  habit_id     INTEGER NOT NULL REFERENCES tally_habits(id) ON DELETE CASCADE,
  completed_on TEXT NOT NULL,             -- YYYY-MM-DD
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (habit_id, completed_on)
);
CREATE INDEX IF NOT EXISTS tally_completions_habit_idx ON tally_completions (habit_id);
`;

const useMemory = process.env.NODE_ENV === "test" && !process.env.DATABASE_URL;
let clientPromise;

async function create() {
  let client;
  if (useMemory) {
    const { PGlite } = await import("@electric-sql/pglite");
    client = new PGlite();
    await client.exec(SCHEMA);
    return client;
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Add your Neon connection string (see README).");
  }
  const { Pool } = require("pg");
  client = new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.PG_POOL_MAX) || 3, idleTimeoutMillis: 10000 });
  // Create the tables if they are missing. Safe to repeat; retried once in case two cold starts race.
  try {
    await client.query(SCHEMA);
  } catch {
    await client.query(SCHEMA);
  }
  return client;
}

function getClient() {
  if (!clientPromise) {
    clientPromise = create().catch((err) => {
      clientPromise = undefined; // try again on the next request
      throw err;
    });
  }
  return clientPromise;
}

// query("SELECT ... WHERE id = $1", [id]) -> { rows: [...] }
async function query(text, params = []) {
  const client = await getClient();
  return client.query(text, params);
}

async function close() {
  if (!clientPromise) return;
  const client = await clientPromise;
  clientPromise = undefined;
  await (client.end ? client.end() : client.close());
}

module.exports = { query, close, getClient, SCHEMA };

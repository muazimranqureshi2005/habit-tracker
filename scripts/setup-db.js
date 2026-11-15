// Optional: creates the tables once from your terminal (npm run db:setup).
// The app also does this by itself on its first request, so this is only a convenient check.
require("dotenv").config();
const { query, close } = require("../src/db");

query("SELECT count(*)::int AS users FROM tally_users")
  .then(({ rows }) => console.log(`Database ready. Tables exist, ${rows[0].users} user(s) so far.`))
  .catch((err) => {
    console.error("Could not set up the database:", err.message);
    process.exitCode = 1;
  })
  .finally(close);

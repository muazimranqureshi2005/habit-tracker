require("dotenv").config(); // reads .env when running locally; on Vercel the dashboard variables are used
const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("path");
const { authRouter } = require("./src/auth");
const { habitsRouter } = require("./src/habits");
const db = require("./src/db");

const app = express();
app.disable("x-powered-by");
if (process.env.VERCEL) app.set("trust proxy", 1); // so rate limiting sees the visitor's IP, not Vercel's

// Basic security headers (scripts only from this site; Google Fonts allowed for the typeface)
app.use((req, res, next) => {
  res.set({
    "Content-Security-Policy":
      "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
  });
  next();
});

app.use(express.json({ limit: "10kb" }));
app.use(cookieParser());

app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.use("/api/auth", authRouter);
app.use("/api", habitsRouter);
app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));

app.use(express.static(path.join(__dirname, "public")));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "That request was not valid JSON." });
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const server = app.listen(port, () => {
    console.log(`Tally is running -> http://localhost:${port}`);
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") console.error(`Port ${port} is busy. Stop the other server or set PORT=3001.`);
    else console.error(err);
    process.exit(1);
  });
  const stop = () => {
    server.close(() => db.close().finally(() => process.exit(0)));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

module.exports = app;

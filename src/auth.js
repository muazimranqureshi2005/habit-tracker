const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const db = require("./db");

// ---- JWT secret ----
// Set JWT_SECRET in your environment (Vercel: Project Settings -> Environment Variables).
// Locally, if it is missing, a temporary one is made (you are logged out whenever the server restarts).
function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET is not set. Add it in your hosting environment variables.");
  }
  if (process.env.NODE_ENV !== "test") console.warn("JWT_SECRET not set: using a temporary secret for this run.");
  return crypto.randomBytes(32).toString("hex");
}
const SECRET = loadSecret();
const COOKIE = "token";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const BCRYPT_ROUNDS = 12;
// Used so that "unknown email" takes as long as "wrong password" (no user enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", BCRYPT_ROUNDS);

const findByEmail = async (email) =>
  (await db.query("SELECT * FROM tally_users WHERE lower(email) = $1", [email])).rows[0];
const findById = async (id) =>
  (await db.query("SELECT id, name, email FROM tally_users WHERE id = $1", [id])).rows[0];
const insertUser = async (name, email, hash) =>
  (await db.query("INSERT INTO tally_users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id", [name, email, hash])).rows[0];

function setSession(res, userId) {
  const token = jwt.sign({ sub: userId }, SECRET, { expiresIn: "7d" });
  res.cookie(COOKIE, token, {
    httpOnly: true, // JavaScript in the page can never read it
    sameSite: "lax", // not sent on cross-site POSTs
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_MS,
  });
}

// Middleware: attaches req.user or answers 401.
async function requireUser(req, res, next) {
  const token = req.cookies?.[COOKIE];
  if (!token) return res.status(401).json({ error: "Please log in." });
  let sub;
  try {
    ({ sub } = jwt.verify(token, SECRET));
  } catch {
    res.clearCookie(COOKIE);
    return res.status(401).json({ error: "Your session expired. Please log in again." });
  }
  // A database error here is a real server error, not a reason to log the person out.
  const user = await findById(sub);
  if (!user) {
    res.clearCookie(COOKIE);
    return res.status(401).json({ error: "Your session expired. Please log in again." });
  }
  req.user = user;
  next();
}

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === "test" ? 1000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again in a few minutes." },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const text = (v) => (typeof v === "string" ? v.trim() : "");

const authRouter = express.Router();

authRouter.post("/signup", limiter, async (req, res) => {
  const name = text(req.body?.name);
  const email = text(req.body?.email).toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  const fields = {};
  if (name.length < 1 || name.length > 60) fields.name = "Enter your name (up to 60 characters).";
  if (!EMAIL_RE.test(email) || email.length > 254) fields.email = "Enter a valid email address.";
  // bcrypt only uses the first 72 bytes, so longer passwords are rejected instead of silently cut.
  if (password.length < 8) fields.password = "Use at least 8 characters.";
  else if (Buffer.byteLength(password) > 72) fields.password = "Use 72 bytes or fewer.";
  if (Object.keys(fields).length) return res.status(400).json({ error: "Please fix the highlighted fields.", fields });

  try {
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const { id } = await insertUser(name, email, hash);
    setSession(res, id);
    res.status(201).json({ user: { id, name, email } });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "An account with that email already exists.", fields: { email: "Already registered. Try logging in." } });
    }
    throw err;
  }
});

authRouter.post("/login", limiter, async (req, res) => {
  const email = text(req.body?.email).toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const user = await findByEmail(email);
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) return res.status(401).json({ error: "Invalid email or password." });
  setSession(res, user.id);
  res.json({ user: { id: user.id, name: user.name, email: user.email } });
});

authRouter.post("/logout", (req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

// Returns { user: null } (not an error) when logged out, so the page can decide what to show.
authRouter.get("/me", async (req, res) => {
  const token = req.cookies?.[COOKIE];
  if (!token) return res.json({ user: null });
  let sub;
  try {
    ({ sub } = jwt.verify(token, SECRET));
  } catch {
    return res.json({ user: null });
  }
  res.json({ user: (await findById(sub)) || null });
});

module.exports = { authRouter, requireUser };

const express = require("express");
const db = require("./db");
const { requireUser } = require("./auth");
const { DAY, toMs, toStr, parseDays, isScheduled, computeStreaks, lastWeek } = require("./streaks");

const router = express.Router();
router.use(["/habits", "/today"], requireUser);

const rows = async (text, params) => (await db.query(text, params)).rows;

const listHabits = (userId) => rows("SELECT * FROM tally_habits WHERE user_id = $1 ORDER BY id", [userId]);
const getHabit = async (id, userId) =>
  (await rows("SELECT * FROM tally_habits WHERE id = $1 AND user_id = $2", [id, userId]))[0];
const completionsForUser = (userId) =>
  rows(
    "SELECT c.habit_id, c.completed_on FROM tally_completions c JOIN tally_habits h ON h.id = c.habit_id WHERE h.user_id = $1",
    [userId]
  );
const completionDates = async (habitId) =>
  (await rows("SELECT completed_on FROM tally_completions WHERE habit_id = $1", [habitId])).map((c) => c.completed_on);
const insertHabit = async (userId, v, startDate) =>
  (await rows(
    "INSERT INTO tally_habits (user_id, name, description, frequency, custom_days, start_date) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
    [userId, v.name, v.description, v.frequency, v.customDays, startDate]
  ))[0];
const updateHabit = async (id, userId, v) =>
  (await rows(
    "UPDATE tally_habits SET name = $1, description = $2, frequency = $3, custom_days = $4 WHERE id = $5 AND user_id = $6 RETURNING *",
    [v.name, v.description, v.frequency, v.customDays, id, userId]
  ))[0];
const deleteHabit = (id, userId) => db.query("DELETE FROM tally_habits WHERE id = $1 AND user_id = $2", [id, userId]);
const addCompletion = (habitId, day) =>
  db.query("INSERT INTO tally_completions (habit_id, completed_on) VALUES ($1, $2) ON CONFLICT (habit_id, completed_on) DO NOTHING", [habitId, day]);
const removeCompletion = (habitId, day) =>
  db.query("DELETE FROM tally_completions WHERE habit_id = $1 AND completed_on = $2", [habitId, day]);

async function datesByHabit(userId) {
  const byHabit = new Map();
  for (const c of await completionsForUser(userId)) {
    if (!byHabit.has(c.habit_id)) byHabit.set(c.habit_id, []);
    byHabit.get(c.habit_id).push(c.completed_on);
  }
  return byHabit;
}

// ---- helpers -------------------------------------------------------------

// The browser sends its own local date (so "today" matches the person's clock, not the server's).
// Accept it only if it is a real date within one day of the server's UTC date.
function resolveDate(input) {
  const serverToday = new Date().toISOString().slice(0, 10);
  if (input === undefined || input === null || input === "") return serverToday;
  if (typeof input !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;
  const ms = Date.parse(input + "T00:00:00Z");
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== input) return null;
  if (Math.abs(ms - toMs(serverToday)) > DAY) return null;
  return input;
}

function habitView(row, dates, today) {
  const { current, longest } = computeStreaks(row, dates, today);
  const days = row.frequency === "custom" ? parseDays(row.custom_days) : row.frequency === "weekdays" ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6];
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    frequency: row.frequency,
    days,
    startDate: row.start_date,
    scheduledToday: isScheduled(row, today) && today >= row.start_date,
    completed: dates.includes(today),
    currentStreak: current,
    longestStreak: longest,
    week: lastWeek(row, dates, today),
  };
}

function validateHabit(body) {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const frequency = body?.frequency;
  const fields = {};

  if (name.length < 1 || name.length > 80) fields.name = "Give the habit a name (up to 80 characters).";
  if (description.length > 300) fields.description = "Keep the description under 300 characters.";
  if (!["daily", "weekdays", "custom"].includes(frequency)) fields.frequency = "Choose daily, weekdays or custom days.";

  let customDays = "";
  if (frequency === "custom") {
    const raw = Array.isArray(body.days) ? body.days : [];
    const days = [...new Set(raw.map(Number))].filter((n) => Number.isInteger(n) && n >= 0 && n <= 6).sort();
    if (days.length === 0 || days.length !== new Set(raw.map(Number)).size) fields.days = "Pick at least one day of the week.";
    customDays = days.join(",");
  }
  if (Object.keys(fields).length) return { error: { error: "Please fix the highlighted fields.", fields } };
  return { value: { name, description, frequency, customDays } };
}

async function loadOwned(req, res) {
  const id = Number(req.params.id);
  const row = Number.isInteger(id) && id > 0 && id < 2147483647 ? await getHabit(id, req.user.id) : undefined;
  if (!row) {
    res.status(404).json({ error: "Habit not found." });
    return null;
  }
  return row;
}

// ---- routes --------------------------------------------------------------

// All habits (the "manage habits" screen)
router.get("/habits", async (req, res) => {
  const today = resolveDate(req.query.date);
  if (!today) return res.status(400).json({ error: "Invalid date." });
  const [habits, byHabit] = await Promise.all([listHabits(req.user.id), datesByHabit(req.user.id)]);
  res.json({ date: today, habits: habits.map((h) => habitView(h, byHabit.get(h.id) || [], today)) });
});

// Today view: only habits scheduled for today, plus a done/total summary
router.get("/today", async (req, res) => {
  const today = resolveDate(req.query.date);
  if (!today) return res.status(400).json({ error: "Invalid date." });
  const [all, byHabit] = await Promise.all([listHabits(req.user.id), datesByHabit(req.user.id)]);
  const habits = all.map((h) => habitView(h, byHabit.get(h.id) || [], today)).filter((h) => h.scheduledToday);
  res.json({ date: today, habits, summary: { done: habits.filter((h) => h.completed).length, total: habits.length } });
});

router.get("/habits/:id", async (req, res) => {
  const today = resolveDate(req.query.date);
  if (!today) return res.status(400).json({ error: "Invalid date." });
  const row = await loadOwned(req, res);
  if (!row) return;
  res.json({ habit: habitView(row, await completionDates(row.id), today) });
});

router.post("/habits", async (req, res) => {
  const today = resolveDate(req.body?.date);
  if (!today) return res.status(400).json({ error: "Invalid date." });
  const { value, error } = validateHabit(req.body);
  if (error) return res.status(400).json(error);
  const row = await insertHabit(req.user.id, value, today);
  res.status(201).json({ habit: habitView(row, [], today) });
});

router.put("/habits/:id", async (req, res) => {
  const today = resolveDate(req.body?.date);
  if (!today) return res.status(400).json({ error: "Invalid date." });
  const row = await loadOwned(req, res);
  if (!row) return;
  const { value, error } = validateHabit(req.body);
  if (error) return res.status(400).json(error);
  const fresh = await updateHabit(row.id, req.user.id, value);
  res.json({ habit: habitView(fresh, await completionDates(row.id), today) });
});

router.delete("/habits/:id", async (req, res) => {
  const row = await loadOwned(req, res);
  if (!row) return;
  await deleteHabit(row.id, req.user.id); // completions go with it (ON DELETE CASCADE)
  res.json({ ok: true });
});

// Check in / un-check for a day. Safe to repeat: UNIQUE(habit_id, completed_on) keeps one entry per day.
router.put("/habits/:id/checkin", async (req, res) => {
  const day = resolveDate(req.body?.date);
  if (!day) return res.status(400).json({ error: "Invalid date." });
  if (typeof req.body?.completed !== "boolean") return res.status(400).json({ error: "Send completed as true or false." });
  const row = await loadOwned(req, res);
  if (!row) return;
  if (req.body.completed) await addCompletion(row.id, day);
  else await removeCompletion(row.id, day);
  res.json({ habit: habitView(row, await completionDates(row.id), day) });
});

module.exports = { habitsRouter: router };

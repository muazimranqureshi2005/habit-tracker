// Pure date/streak logic (no database, no server) so it is easy to test.
// Dates are "YYYY-MM-DD" strings. Day of week: 0 = Sunday ... 6 = Saturday.

const DAY = 86400000;
const toMs = (d) => {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, day);
};
const toStr = (ms) => new Date(ms).toISOString().slice(0, 10);
const weekday = (d) => new Date(toMs(d)).getUTCDay();

function parseDays(customDays) {
  if (Array.isArray(customDays)) return customDays;
  return String(customDays || "")
    .split(",")
    .filter((s) => s !== "")
    .map(Number);
}

// Is the habit meant to be done on this date?
function isScheduled(habit, date) {
  const dow = weekday(date);
  if (habit.frequency === "daily") return true;
  if (habit.frequency === "weekdays") return dow >= 1 && dow <= 5;
  return parseDays(habit.custom_days).includes(dow);
}

/**
 * Streak rules:
 *  - Only scheduled days count. Days the habit is not scheduled are skipped and never break a streak.
 *  - Missing a past scheduled day resets the current streak to 0.
 *  - If today is scheduled but not done yet, the streak is kept (you still have today to do it).
 *  - Nothing before the habit's start date is counted.
 */
function computeStreaks(habit, completedDates, today) {
  const done = new Set(completedDates);
  let start = habit.start_date;
  for (const d of done) if (d < start) start = d;

  let run = 0;
  let longest = 0;
  for (let t = toMs(start); t <= toMs(today); t += DAY) {
    const d = toStr(t);
    if (!isScheduled(habit, d)) continue;
    if (done.has(d)) {
      run += 1;
      if (run > longest) longest = run;
    } else if (d !== today) {
      run = 0;
    }
  }
  return { current: run, longest };
}

// The last 7 days (oldest first) for the little dot strip in the UI.
function lastWeek(habit, completedDates, today) {
  const done = new Set(completedDates);
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const d = toStr(toMs(today) - i * DAY);
    out.push({ date: d, scheduled: d >= habit.start_date && isScheduled(habit, d), done: done.has(d) });
  }
  return out;
}

module.exports = { DAY, toMs, toStr, parseDays, isScheduled, computeStreaks, lastWeek };

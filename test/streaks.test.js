const test = require("node:test");
const assert = require("node:assert");
const { computeStreaks, isScheduled } = require("../src/streaks");

// 2026-11-09 is a Monday.
const daily = { frequency: "daily", custom_days: "", start_date: "2026-11-09" };
const weekdays = { frequency: "weekdays", custom_days: "", start_date: "2026-11-09" };

test("daily: consecutive days build a streak", () => {
  const r = computeStreaks(daily, ["2026-11-09", "2026-11-10", "2026-11-11"], "2026-11-11");
  assert.deepStrictEqual(r, { current: 3, longest: 3 });
});

test("today not done yet keeps the streak alive", () => {
  const r = computeStreaks(daily, ["2026-11-09", "2026-11-10"], "2026-11-11");
  assert.deepStrictEqual(r, { current: 2, longest: 2 });
});

test("a missed past day resets current but keeps longest", () => {
  const r = computeStreaks(daily, ["2026-11-09", "2026-11-10", "2026-11-12"], "2026-11-12");
  assert.deepStrictEqual(r, { current: 1, longest: 2 });
});

test("weekdays: weekend does not break the streak", () => {
  const r = computeStreaks(weekdays, ["2026-11-12", "2026-11-13", "2026-11-16"], "2026-11-16");
  // Thu, Fri, Mon are consecutive scheduled days; Mon-Wed of the first week were missed.
  assert.deepStrictEqual(r, { current: 3, longest: 3 });
});

test("custom days: only chosen days count", () => {
  const mwf = { frequency: "custom", custom_days: "1,3,5", start_date: "2026-11-09" };
  assert.strictEqual(isScheduled(mwf, "2026-11-10"), false); // Tuesday
  assert.strictEqual(isScheduled(mwf, "2026-11-11"), true); // Wednesday
  const r = computeStreaks(mwf, ["2026-11-09", "2026-11-11", "2026-11-13"], "2026-11-13");
  assert.deepStrictEqual(r, { current: 3, longest: 3 });
});

test("no completions gives zero", () => {
  assert.deepStrictEqual(computeStreaks(daily, [], "2026-11-15"), { current: 0, longest: 0 });
});

test("days before the start date are not counted as misses", () => {
  const h = { ...daily, start_date: "2026-11-14" };
  assert.deepStrictEqual(computeStreaks(h, ["2026-11-14", "2026-11-15"], "2026-11-15"), { current: 2, longest: 2 });
});

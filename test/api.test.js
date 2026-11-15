process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert");
const app = require("../server");
const db = require("../src/db");

let server, base;
test.before(async () => {
  await new Promise((resolve) => (server = app.listen(0, resolve)));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  server.close();
  await db.close();
});

// tiny client that keeps its own cookie, like a browser tab
function client() {
  let cookie = "";
  return async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0].endsWith("=") ? "" : set.split(";")[0];
    let json = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, json, setCookie: set };
  };
}
const today = new Date().toISOString().slice(0, 10);

test("auth: signup hashes the password, cookie is httpOnly, login/logout work", async () => {
  const a = client();
  const r = await a("POST", "/api/auth/signup", { name: "Ada", email: "Ada@Example.com", password: "correct horse" });
  assert.strictEqual(r.status, 201);
  assert.match(r.setCookie, /HttpOnly/i);

  const row = (await db.query("SELECT password_hash, email FROM tally_users WHERE lower(email) = $1", ["ada@example.com"])).rows[0];
  assert.match(row.password_hash, /^\$2[aby]\$12\$/); // bcrypt, cost 12
  assert.notStrictEqual(row.password_hash, "correct horse");
  assert.strictEqual(row.email, "ada@example.com");

  assert.strictEqual((await a("GET", "/api/auth/me")).json.user.name, "Ada");
  await a("POST", "/api/auth/logout");
  assert.strictEqual((await a("GET", "/api/auth/me")).json.user, null);
  assert.strictEqual((await a("GET", "/api/habits")).status, 401);

  assert.strictEqual((await a("POST", "/api/auth/login", { email: "ada@example.com", password: "wrong password" })).status, 401);
  assert.strictEqual((await a("POST", "/api/auth/login", { email: "nobody@example.com", password: "whatever12" })).status, 401);
  assert.strictEqual((await a("POST", "/api/auth/login", { email: "ADA@example.com", password: "correct horse" })).status, 200);
});

test("auth: validation and duplicate email", async () => {
  const a = client();
  assert.strictEqual((await a("POST", "/api/auth/signup", { name: "", email: "bad", password: "short" })).status, 400);
  await a("POST", "/api/auth/signup", { name: "Bo", email: "bo@example.com", password: "password123" });
  const dup = await client()("POST", "/api/auth/signup", { name: "Bo2", email: "BO@example.com", password: "password123" });
  assert.strictEqual(dup.status, 409);
});

test("habits: create, view, edit, delete, validation", async () => {
  const a = client();
  await a("POST", "/api/auth/signup", { name: "Cy", email: "cy@example.com", password: "password123" });

  assert.strictEqual((await a("POST", "/api/habits", { name: "", frequency: "daily", date: today })).status, 400);
  assert.strictEqual((await a("POST", "/api/habits", { name: "Run", frequency: "custom", days: [], date: today })).status, 400);
  assert.strictEqual((await a("POST", "/api/habits", { name: "Run", frequency: "yearly", date: today })).status, 400);

  const created = await a("POST", "/api/habits", { name: "Read", description: "20 pages", frequency: "daily", date: today });
  assert.strictEqual(created.status, 201);
  const id = created.json.habit.id;

  const list = await a("GET", `/api/habits?date=${today}`);
  assert.strictEqual(list.json.habits.length, 1);
  assert.strictEqual((await a("GET", `/api/habits/${id}?date=${today}`)).json.habit.description, "20 pages");

  const edited = await a("PUT", `/api/habits/${id}`, { name: "Read more", description: "", frequency: "custom", days: [1, 3, 5], date: today });
  assert.strictEqual(edited.json.habit.name, "Read more");
  assert.deepStrictEqual(edited.json.habit.days, [1, 3, 5]);

  assert.strictEqual((await a("DELETE", `/api/habits/${id}`)).status, 200);
  assert.strictEqual((await a("GET", `/api/habits/${id}?date=${today}`)).status, 404);
});

test("check-in: one entry per habit per day, undo works, streak updates", async () => {
  const a = client();
  await a("POST", "/api/auth/signup", { name: "Di", email: "di@example.com", password: "password123" });
  const { json } = await a("POST", "/api/habits", { name: "Stretch", frequency: "daily", date: today });
  const id = json.habit.id;

  let r = await a("PUT", `/api/habits/${id}/checkin`, { completed: true, date: today });
  assert.strictEqual(r.json.habit.completed, true);
  assert.strictEqual(r.json.habit.currentStreak, 1);
  await a("PUT", `/api/habits/${id}/checkin`, { completed: true, date: today }); // repeat: no duplicate
  await a("PUT", `/api/habits/${id}/checkin`, { completed: true, date: today });
  assert.strictEqual((await db.query("SELECT COUNT(*)::int AS n FROM tally_completions WHERE habit_id = $1", [id])).rows[0].n, 1);

  const t = await a("GET", `/api/today?date=${today}`);
  assert.deepStrictEqual(t.json.summary, { done: 1, total: 1 });

  r = await a("PUT", `/api/habits/${id}/checkin`, { completed: false, date: today });
  assert.strictEqual(r.json.habit.completed, false);
  assert.strictEqual(r.json.habit.currentStreak, 0);

  assert.strictEqual((await a("PUT", `/api/habits/${id}/checkin`, { completed: "yes", date: today })).status, 400);
  assert.strictEqual((await a("PUT", `/api/habits/${id}/checkin`, { completed: true, date: "2020-01-01" })).status, 400);
  assert.strictEqual((await a("PUT", `/api/habits/${id}/checkin`, { completed: true, date: "2026-02-31" })).status, 400);
});

test("today view only lists habits scheduled today", async () => {
  const a = client();
  await a("POST", "/api/auth/signup", { name: "Ed", email: "ed@example.com", password: "password123" });
  const dow = new Date(today + "T00:00:00Z").getUTCDay();
  const other = (dow + 3) % 7;
  await a("POST", "/api/habits", { name: "Today one", frequency: "custom", days: [dow], date: today });
  await a("POST", "/api/habits", { name: "Other day", frequency: "custom", days: [other], date: today });
  const t = await a("GET", `/api/today?date=${today}`);
  assert.deepStrictEqual(t.json.habits.map((h) => h.name), ["Today one"]);
  assert.strictEqual((await a("GET", `/api/habits?date=${today}`)).json.habits.length, 2);
});

test("users cannot see or change each other's habits", async () => {
  const a = client();
  const b = client();
  await a("POST", "/api/auth/signup", { name: "A", email: "a1@example.com", password: "password123" });
  await b("POST", "/api/auth/signup", { name: "B", email: "b1@example.com", password: "password123" });
  const id = (await a("POST", "/api/habits", { name: "Private", frequency: "daily", date: today })).json.habit.id;

  assert.strictEqual((await b("GET", `/api/habits/${id}?date=${today}`)).status, 404);
  assert.strictEqual((await b("PUT", `/api/habits/${id}`, { name: "Hacked", frequency: "daily", date: today })).status, 404);
  assert.strictEqual((await b("PUT", `/api/habits/${id}/checkin`, { completed: true, date: today })).status, 404);
  assert.strictEqual((await b("DELETE", `/api/habits/${id}`)).status, 404);
  assert.strictEqual((await b("GET", `/api/habits?date=${today}`)).json.habits.length, 0);
  assert.strictEqual((await a("GET", `/api/habits/${id}?date=${today}`)).json.habit.name, "Private");
});

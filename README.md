# Tally: Daily Habit Tracker

A small full-stack web app for tracking daily habits. Sign up, add habits, tick them off each day and watch your streaks grow.

**Stack:** Node.js + Express, Postgres (Neon), bcrypt password hashing, JWT session in an httpOnly cookie, plain HTML/CSS/JS frontend (no build step). Runs locally and on Vercel.

## Run it locally

You need [Node.js](https://nodejs.org) 20 or newer and a free [Neon](https://neon.tech) Postgres database.

```bash
npm install
```

1. Copy the template: `copy .env.example .env` (PowerShell) or `cp .env.example .env` (Mac/Linux).
2. In Neon: **Connect** and copy the connection string into `DATABASE_URL` in `.env`.
3. Generate a secret and paste it into `JWT_SECRET`:
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
4. Start it:

```bash
npm start
```

Open **http://localhost:3000**. The tables (`tally_users`, `tally_habits`, `tally_completions`) are created automatically on the first request. `npm run db:setup` checks the connection from the terminal.

- `npm run dev` restarts the server when you edit server files.
- `npm test` runs 13 automated tests. They use an in-memory Postgres, so they need no database setup.

## Deploy to Vercel

1. Push the project to GitHub (`.env` is ignored, so your secrets stay out).
2. On vercel.com choose **Add New, then Project**, import the repo and leave every build setting on its default. Vercel detects Express from `server.js`.
3. Before deploying, open **Environment Variables** and add `DATABASE_URL` (your Neon string) and `JWT_SECRET` (a new random string).
4. Click **Deploy**. Open the `.vercel.app` link, sign up and test it.

Files in `public/` are served by Vercel's CDN, and the `/api/*` routes run as a serverless function. After the first deploy, every `git push` to `main` redeploys automatically.

Why Postgres: Vercel functions have no disk that persists between requests, so a file database like SQLite would lose its data. Neon keeps it outside Vercel.

## Spec checklist

| Requirement | Where |
|---|---|
| **Auth:** sign up, log in, log out | `src/auth.js` (`/api/auth/signup`, `/login`, `/logout`) |
| Passwords hashed with bcrypt | `bcryptjs`, cost factor 12; plain passwords are never stored |
| Session or JWT | JWT in an `httpOnly`, `sameSite=lax` cookie (7 days) |
| **Habit CRUD** (name, description, daily / weekdays / custom days) | `src/habits.js`, "Habits" tab in the UI |
| **Daily check-in**, one entry per habit per day | `PUT /api/habits/:id/checkin`; `UNIQUE (habit_id, completed_on)` in the database |
| **Today view** with checkboxes | "Today" tab: only habits scheduled for today, with a progress bar |
| **Streaks:** current and longest per habit | `src/streaks.js`, shown on every habit |
| **Persistence:** users, habits, completions | Postgres tables in `src/db.js` |

## How streaks work

- Only days the habit is **scheduled** count. A weekday habit skips Saturday and Sunday without breaking the streak; a Mon/Wed/Fri habit only looks at those days.
- Missing a past scheduled day resets the **current** streak to 0. The **longest** streak keeps the best run ever.
- If today is scheduled but not ticked yet, the streak stays alive until you tick it.
- Days before the habit was created are never counted as misses.
- If you change a habit's schedule later, streaks are recalculated with the new schedule.

"Today" is the date on the person's own device, so it matches their clock rather than the server's time zone.

## Database

```
tally_users        id, name, email (unique, case-insensitive), password_hash, created_at
tally_habits       id, user_id -> tally_users, name, description, frequency, custom_days, start_date, created_at
tally_completions  id, habit_id -> tally_habits, completed_on, created_at     UNIQUE (habit_id, completed_on)
```

Unchecking a habit deletes its completion row. Deleting a habit removes its completions too (`ON DELETE CASCADE`). The `tally_` prefix keeps these tables separate from any other project in the same Neon database.

## API

All `/api/habits*` and `/api/today` routes need a logged-in session. Dates are `YYYY-MM-DD`.

| Method | Path | What it does |
|---|---|---|
| POST | `/api/auth/signup` | `{ name, email, password }` creates an account and logs in |
| POST | `/api/auth/login` | `{ email, password }` |
| POST | `/api/auth/logout` | Clears the session cookie |
| GET | `/api/auth/me` | `{ user }`, or `{ user: null }` when logged out |
| GET | `/api/habits?date=` | All habits with streaks and the last 7 days |
| POST | `/api/habits` | `{ name, description, frequency, days, date }` |
| GET | `/api/habits/:id?date=` | One habit |
| PUT | `/api/habits/:id` | Edit a habit (same body as create) |
| DELETE | `/api/habits/:id` | Delete a habit and its history |
| GET | `/api/today?date=` | Habits scheduled today, plus `{ done, total }` |
| PUT | `/api/habits/:id/checkin` | `{ date, completed: true/false }` |

`frequency` is `daily`, `weekdays` or `custom`. For `custom`, `days` is a list of weekday numbers (0 = Sunday ... 6 = Saturday).

## Security notes

- Passwords: bcrypt (cost 12), 8 to 72 characters. Login gives the same error for a wrong email or a wrong password.
- Session cookie is `httpOnly` (page scripts can't read it), `sameSite=lax`, and `secure` in production.
- Every database query is parameterized (`$1`, `$2`), so SQL injection is not possible. Every habit query also filters by the logged-in user, so one account can never read or change another's habits.
- Input is validated on the server. User text is only ever inserted into the page as text, never as HTML.
- Login and sign-up are rate limited. On Vercel the counter is kept per server instance, so treat it as basic protection.
- Secrets live in environment variables (`.env` locally, the Vercel dashboard when deployed), never in the code.

## Project layout

```
server.js            Express app (exported for Vercel, started directly for local use)
src/db.js            Postgres connection and tables
src/auth.js          sign up / log in / log out, JWT middleware
src/habits.js        habit CRUD, today view, check-ins
src/streaks.js       schedule and streak calculation (pure functions)
public/              the frontend (index.html, css/style.css, js/app.js)
test/                automated tests (node:test)
vercel.json          security headers for the static files
```

## Troubleshooting

| Problem | Fix |
|---|---|
| PowerShell says scripts are disabled | `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`, or use `npm.cmd install` |
| `DATABASE_URL is not set` | `.env` must sit next to `package.json`, or add the variable in Vercel and redeploy |
| `JWT_SECRET is not set` (Vercel) | Add `JWT_SECRET` under Environment Variables, then redeploy |
| Sign up fails with a server error on Vercel | Open the deployment's **Logs** tab. Usually a wrong `DATABASE_URL` (no quotes or spaces around it). |
| Page loads but the API returns 404 on Vercel | The entry file must be `server.js` at the project root with `module.exports = app` |
| `Port 3000 is busy` | Set a different port (PowerShell: `$env:PORT=3001; npm start`) |

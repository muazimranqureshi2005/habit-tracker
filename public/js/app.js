(() => {
  "use strict";

  // ---------- tiny helpers ----------
  const NS = "http://www.w3.org/2000/svg";
  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const PICKER_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first

  // Build DOM safely: text goes in as text nodes, never as HTML.
  function h(tag, props = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "value") el.value = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  function svg(pathD, extra = {}) {
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", "3");
    s.setAttribute("stroke-linecap", "round");
    s.setAttribute("stroke-linejoin", "round");
    s.setAttribute("aria-hidden", "true");
    for (const [k, v] of Object.entries(extra)) s.setAttribute(k, v);
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", pathD);
    s.append(p);
    return s;
  }
  const checkIcon = () => svg("M5 12.5l4.5 4.5L19 7");
  const pad = (n) => String(n).padStart(2, "0");
  const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || "Something went wrong. Please try again.");
      err.status = res.status;
      err.fields = (data && data.fields) || {};
      throw err;
    }
    return data;
  }

  let toastTimer;
  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
  }

  // ---------- state ----------
  const root = document.getElementById("app");
  const state = { user: null, tab: "today", date: localDate(), today: null, habits: null, authMode: "login", notice: "" };

  function freqLabel(habit) {
    if (habit.frequency === "daily") return "Every day";
    if (habit.frequency === "weekdays") return "Weekdays";
    return PICKER_ORDER.filter((d) => habit.days.includes(d)).map((d) => DAY_NAMES[d]).join(", ");
  }
  // Each habit gets its own colour, derived from its id, so rows are easy to tell apart.
  const hueFor = (id) => (id * 67 + 205) % 360;

  function streakMeta(habit) {
    const s = habit.currentStreak;
    return h("div", { class: "row-meta" },
      s > 0 ? h("span", { class: "streak" }, `${plural(s, "day")} in a row`) : h("span", {}, "No streak yet"),
      h("span", {}, `Best: ${plural(habit.longestStreak, "day")}`)
    );
  }
  function weekStrip(habit) {
    return h("div", { class: "week", role: "img", "aria-label": "Last 7 days" },
      habit.week.map((d) =>
        h("span", { class: "dot " + (d.done ? "on " : "") + (d.scheduled ? "sched" : "off"), title: d.date })
      )
    );
  }

  // ---------- sign in / sign up ----------
  function renderAuth() {
    const signup = state.authMode === "signup";
    const err = h("p", { class: "form-error", hidden: true });
    const fieldErr = {};
    const field = (id, label, type, props = {}) => {
      fieldErr[id] = h("div", { class: "field-error", id: `${id}-err` });
      return h("div", { class: "field" },
        h("label", { for: id }, label),
        h("input", { id, name: id, type, required: true, "aria-describedby": `${id}-err`, ...props }),
        fieldErr[id]
      );
    };
    const submit = h("button", { class: "btn primary", type: "submit" }, signup ? "Create account" : "Log in");

    const form = h("form", {
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        err.hidden = true;
        Object.values(fieldErr).forEach((n) => (n.textContent = ""));
        const data = Object.fromEntries(new FormData(form));
        submit.disabled = true;
        try {
          const res = await api("POST", signup ? "/api/auth/signup" : "/api/auth/login", data);
          state.user = res.user;
          state.notice = "";
          state.tab = "today";
          await showTab("today");
        } catch (ex) {
          err.textContent = ex.message;
          err.hidden = false;
          for (const [k, v] of Object.entries(ex.fields || {})) if (fieldErr[k]) fieldErr[k].textContent = v;
          submit.disabled = false;
        }
      },
    },
      err,
      signup ? field("name", "Your name", "text", { autocomplete: "name", maxlength: 60 }) : null,
      field("email", "Email", "email", { autocomplete: "email", maxlength: 254 }),
      field("password", "Password", "password", { autocomplete: signup ? "new-password" : "current-password", minlength: 8 }),
      signup ? h("p", { class: "hint field" }, "Use at least 8 characters.") : null,
      submit
    );

    const tab = (mode, label) =>
      h("button", { type: "button", role: "tab", "aria-selected": String(state.authMode === mode), onclick: () => { state.authMode = mode; renderAuth(); } }, label);

    root.replaceChildren(
      h("main", { class: "auth" },
        h("h1", {}, "Tally"),
        h("p", { class: "lede" }, state.notice || "Check off today's habits and watch your streaks grow."),
        h("div", { class: "tabs", role: "tablist" }, tab("login", "Log in"), tab("signup", "Sign up")),
        form
      )
    );
    form.querySelector("input")?.focus();
  }

  // ---------- app shell ----------
  function renderShell(content) {
    const nav = (id, label) =>
      h("button", { type: "button", "aria-current": state.tab === id ? "page" : null, onclick: () => showTab(id) }, label);
    root.replaceChildren(
      h("div", { class: "shell" },
        h("header", { class: "topbar" },
          h("div", { class: "wordmark" },
            svg("M6 12.5l4 4 8-9", { "stroke-width": "3.4" }), "Tally"),
          h("nav", { class: "nav", "aria-label": "Main" }, nav("today", "Today"), nav("habits", "Habits")),
          h("div", { class: "who" },
            h("span", { class: "name" }, state.user.name),
            h("button", { class: "link", type: "button", onclick: logout }, "Log out"))
        ),
        h("main", { id: "view" }, content)
      )
    );
  }

  async function logout() {
    try { await api("POST", "/api/auth/logout"); } catch { /* ignore */ }
    state.user = null; state.today = null; state.habits = null; state.authMode = "login"; state.notice = "";
    renderAuth();
  }

  function handleError(ex) {
    if (ex.status === 401) {
      state.user = null;
      state.authMode = "login";
      state.notice = "Your session ended. Log in to continue.";
      renderAuth();
    } else {
      toast(ex.message);
    }
  }

  async function showTab(tab) {
    state.tab = tab;
    state.date = localDate();
    try {
      if (tab === "today") {
        state.today = await api("GET", `/api/today?date=${state.date}`);
        renderToday();
      } else {
        state.habits = (await api("GET", `/api/habits?date=${state.date}`)).habits;
        renderManage();
      }
    } catch (ex) { handleError(ex); }
  }

  // ---------- today ----------
  function dayRow(habit) {
    const row = h("li", { class: "row" + (habit.completed ? " done" : ""), "data-id": habit.id },
      h("button", {
        class: "stamp", type: "button", role: "checkbox",
        "aria-checked": String(habit.completed), "aria-label": habit.name,
        onclick: () => toggle(habit.id),
      }, checkIcon()),
      h("div", { class: "row-main" },
        h("div", { class: "row-name" }, habit.name),
        habit.description ? h("div", { class: "row-desc" }, habit.description) : null,
        streakMeta(habit)
      ),
      weekStrip(habit)
    );
    row.style.setProperty("--h", hueFor(habit.id));
    return row;
  }

  function progressBlock() {
    const { done, total } = state.today.summary;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const bar = h("span");
    bar.style.width = pct + "%";
    return h("div", { class: "progress", id: "progress" },
      h("div", { class: "progress-text" },
        h("span", {}, `${done} of ${total} done`),
        h("span", { class: "note" }, total && done === total ? "All done for today" : "")),
      h("div", { class: "bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct), "aria-label": "Today's progress" }, bar)
    );
  }

  function renderToday() {
    const d = new Date(state.today.date + "T12:00:00");
    const weekday = d.toLocaleDateString(undefined, { weekday: "long" });
    const full = d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
    const { habits } = state.today;

    const body = habits.length
      ? h("ul", { class: "list", id: "today-list" }, habits.map(dayRow))
      : h("div", { class: "empty" },
          h("h2", {}, state.today.summary.total === 0 ? "Nothing scheduled today" : ""),
          h("p", {}, "Habits you add show up here on the days they repeat."),
          h("button", { class: "btn primary", type: "button", onclick: () => openHabitDialog() }, "Add a habit"));

    renderShell(h("section", {},
      h("div", { class: "today-head" },
        h("h1", {}, weekday),
        h("p", { class: "full-date" }, full),
        habits.length ? progressBlock() : null),
      body));
  }

  async function toggle(id) {
    const list = state.today.habits;
    const i = list.findIndex((x) => x.id === id);
    const before = list[i];
    const want = !before.completed;

    // Update the screen right away, then confirm with the server.
    list[i] = { ...before, completed: want };
    refreshToday(id);
    try {
      const { habit } = await api("PUT", `/api/habits/${id}/checkin`, { date: state.today.date, completed: want });
      list[i] = habit;
    } catch (ex) {
      list[i] = before;
      if (ex.status !== 401) toast("Couldn't save that. Try again.");
      else handleError(ex);
    }
    state.today.summary = { done: list.filter((x) => x.completed).length, total: list.length };
    refreshToday(id);
  }

  // Re-draw one row + the progress block without losing keyboard focus.
  function refreshToday(focusId) {
    const list = document.getElementById("today-list");
    if (!list) return;
    const habit = state.today.habits.find((x) => x.id === focusId);
    const old = list.querySelector(`[data-id="${focusId}"]`);
    if (habit && old) {
      const fresh = dayRow(habit);
      old.replaceWith(fresh);
      fresh.querySelector(".stamp").focus();
    }
    const p = document.getElementById("progress");
    if (p) p.replaceWith(progressBlock());
  }

  // ---------- manage habits ----------
  function manageRow(habit) {
    const row = h("li", { class: "row manage", "data-id": habit.id },
      h("div", { class: "swatch", "aria-hidden": "true" }),
      h("div", { class: "row-main" },
        h("div", { class: "row-name" }, habit.name),
        habit.description ? h("div", { class: "row-desc" }, habit.description) : null,
        h("div", { class: "row-meta" },
          h("span", { class: "freq" }, freqLabel(habit)),
          habit.currentStreak > 0 ? h("span", { class: "streak" }, `${plural(habit.currentStreak, "day")} in a row`) : h("span", {}, "No streak yet"),
          h("span", {}, `Best: ${plural(habit.longestStreak, "day")}`))
      ),
      h("div", { class: "actions" },
        h("button", { class: "btn", type: "button", "aria-label": `Edit ${habit.name}`, onclick: () => openHabitDialog(habit) }, "Edit"),
        h("button", { class: "btn", type: "button", "aria-label": `Delete ${habit.name}`, onclick: () => openDeleteDialog(habit) }, "Delete"))
    );
    row.style.setProperty("--h", hueFor(habit.id));
    return row;
  }

  function renderManage() {
    const body = state.habits.length
      ? h("ul", { class: "list" }, state.habits.map(manageRow))
      : h("div", { class: "empty" },
          h("h2", {}, "No habits yet"),
          h("p", {}, "Start with one small thing you want to do every day."),
          h("button", { class: "btn primary", type: "button", onclick: () => openHabitDialog() }, "Add your first habit"));
    renderShell(h("section", {},
      h("div", { class: "page-head" },
        h("h1", {}, "Your habits"),
        state.habits.length ? h("button", { class: "btn primary", type: "button", onclick: () => openHabitDialog() }, "New habit") : null),
      body));
  }

  // ---------- dialogs ----------
  function openDialog(build) {
    const dlg = h("dialog");
    dlg.append(h("div", { class: "dialog-body" }, build(dlg)));
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    return dlg;
  }

  function openHabitDialog(habit) {
    const editing = !!habit;
    openDialog((dlg) => {
      const err = h("p", { class: "form-error", hidden: true });
      const errs = { name: h("div", { class: "field-error" }), description: h("div", { class: "field-error" }), days: h("div", { class: "field-error" }) };
      const freq = habit ? habit.frequency : "daily";
      const selectedDays = new Set(habit && habit.frequency === "custom" ? habit.days : [1, 3, 5]);

      const daysBox = h("div", { class: "radio-row days", role: "group", "aria-label": "Days of the week" },
        PICKER_ORDER.map((d) =>
          h("label", { class: "pill" },
            h("input", { type: "checkbox", name: "day", value: d, checked: selectedDays.has(d) }),
            h("span", {}, DAY_NAMES[d]))
        )
      );
      const radio = (value, label) =>
        h("label", { class: "pill" },
          h("input", { type: "radio", name: "frequency", value, checked: freq === value, onchange: sync }),
          h("span", {}, label));
      const daysField = h("div", {}, daysBox, errs.days);

      function sync() {
        daysField.hidden = form.elements.frequency.value !== "custom";
      }

      const save = h("button", { class: "btn primary", type: "submit" }, editing ? "Save changes" : "Add habit");
      const form = h("form", {
        novalidate: true,
        onsubmit: async (e) => {
          e.preventDefault();
          err.hidden = true;
          Object.values(errs).forEach((n) => (n.textContent = ""));
          const payload = {
            name: form.elements.name.value,
            description: form.elements.description.value,
            frequency: form.elements.frequency.value,
            days: [...form.querySelectorAll('input[name="day"]:checked')].map((c) => Number(c.value)),
            date: localDate(),
          };
          save.disabled = true;
          try {
            await (editing ? api("PUT", `/api/habits/${habit.id}`, payload) : api("POST", "/api/habits", payload));
            dlg.close();
            toast(editing ? "Saved" : "Habit added");
            await showTab(state.tab);
          } catch (ex) {
            if (ex.status === 401) { dlg.close(); return handleError(ex); }
            err.textContent = ex.message;
            err.hidden = false;
            for (const [k, v] of Object.entries(ex.fields || {})) if (errs[k]) errs[k].textContent = v;
            save.disabled = false;
          }
        },
      },
        err,
        h("div", { class: "field" },
          h("label", { for: "habit-name" }, "Name"),
          h("input", { id: "habit-name", name: "name", type: "text", maxlength: 80, required: true, value: habit ? habit.name : "", placeholder: "Drink water, Read 20 pages, Stretch" }),
          errs.name),
        h("div", { class: "field" },
          h("label", { for: "habit-desc" }, "Description (optional)"),
          h("textarea", { id: "habit-desc", name: "description", maxlength: 300 }, habit ? habit.description : ""),
          errs.description),
        h("fieldset", {},
          h("legend", {}, "How often?"),
          h("div", { class: "radio-row" }, radio("daily", "Every day"), radio("weekdays", "Weekdays"), radio("custom", "Custom days")),
          daysField),
        h("div", { class: "dialog-actions" },
          h("button", { class: "btn", type: "button", onclick: () => dlg.close() }, "Cancel"),
          save)
      );
      sync();
      queueMicrotask(() => form.elements.name.focus());
      return [h("h2", {}, editing ? "Edit habit" : "New habit"), form];
    });
  }

  function openDeleteDialog(habit) {
    openDialog((dlg) => {
      const del = h("button", { class: "btn danger", type: "button", onclick: async () => {
        del.disabled = true;
        try {
          await api("DELETE", `/api/habits/${habit.id}`);
          dlg.close();
          toast("Habit deleted");
          await showTab(state.tab);
        } catch (ex) { dlg.close(); handleError(ex); }
      } }, "Delete habit");
      return [
        h("h2", {}, `Delete "${habit.name}"?`),
        h("p", {}, "Its check-in history and streaks are removed too. This can't be undone."),
        h("div", { class: "dialog-actions" }, h("button", { class: "btn", type: "button", onclick: () => dlg.close() }, "Keep it"), del),
      ];
    });
  }

  // ---------- start ----------
  // If the tab stays open past midnight, refresh when the person comes back to it.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.user && localDate() !== state.date && !document.querySelector("dialog[open]")) showTab(state.tab);
  });

  (async function init() {
    try {
      const { user } = await api("GET", "/api/auth/me");
      state.user = user;
    } catch { state.user = null; }
    if (state.user) await showTab("today");
    else renderAuth();
  })();
})();

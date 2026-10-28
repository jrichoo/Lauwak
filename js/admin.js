// Admin dashboard: talks to Django via Node at /api/admin/*.
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const fmt = (iso) =>
    iso
      ? new Date(iso).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "Never";
  let theme = null;
  try {
    theme = localStorage.getItem("theme");
  } catch {}
  if (theme) document.documentElement.setAttribute("data-theme", theme);

  function showMsg(text) {
    $("adMsg").textContent = text;
    $("adMsg").hidden = !text;
  }

  async function api(path, opts = {}) {
    // Split the query off first: appending the slash to the whole string would put
    // it inside the search value, so every filtered search returned no rows.
    const [base, query] = path.split("?");
    const url =
      "/api/admin/" +
      base +
      (base.endsWith("/") ? "" : "/") +
      (query ? "?" + query : "");
    const r = await fetch(url, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401) {
      location.replace(
        "/user/login.html?next=" + encodeURIComponent("/admin.html"),
      );
      throw new Error("login");
    }
    if (!r.ok) {
      const err = new Error(data.error || "Request failed (" + r.status + ")");
      err.status = r.status;
      throw err;
    }
    return data;
  }

  // A bare "Request failed (503)" tells an admin nothing; say what to do about it.
  function hint(e) {
    if (e.status === 503)
      return "account server is offline — start Django, then reload";
    if (e.status === 403) return "this email is not in LAUWAK_ADMIN_EMAILS";
    return e.message;
  }

  async function loadOverview() {
    const o = await api("overview");
    const signups = Array.isArray(o.signups) ? o.signups : [];
    $("kUsers").textContent = o.users;
    $("kNew").textContent = o.new_7d;
    $("kActive").textContent = o.active_24h;
    $("kSessions").textContent = o.sessions;
    $("kFailed").textContent = o.failed_24h;
    const max = Math.max(1, ...signups.map((d) => d.n));
    $("adChart").innerHTML = signups
      .map((d) => {
        const label = new Date(d.day + "T00:00:00").toLocaleDateString(
          undefined,
          { month: "short", day: "numeric" },
        );
        return `<div class="ad-bar" title="${label}: ${d.n}"><span style="height:${(d.n / max) * 100}%"></span><small>${label.split(" ")[1]}</small></div>`;
      })
      .join("");
  }

  async function loadUsers() {
    const q = $("adSearch").value.trim();
    const { users } = await api(
      "users" + (q ? "?q=" + encodeURIComponent(q) : ""),
    );
    const rows = Array.isArray(users) ? users : [];
    $("adUsers").innerHTML = rows.length
      ? rows
          .map(
            (u) => `<tr>
        <td>${esc(u.name)}${u.admin ? ' <em class="ad-tag">admin</em>' : ""}</td>
        <td>${esc(u.email)}</td>
        <td>${fmt(u.created)}</td>
        <td>${fmt(u.last_login)}</td>
        <td>${u.logins}</td>
        <td><span class="ad-status ${u.active ? "on" : "off"}">${u.active ? "Active" : "Disabled"}</span></td>
        <td class="ad-actions">${
          u.admin
            ? ""
            : `<button data-id="${u.id}" data-act="logout" title="Sign out everywhere">Sign out</button>
               <button data-id="${u.id}" data-act="${u.active ? "disable" : "enable"}">${u.active ? "Disable" : "Enable"}</button>
               <button data-id="${u.id}" data-act="delete" class="danger" data-name="${esc(u.email)}">Delete</button>`
        }</td></tr>`,
          )
          .join("")
      : '<tr><td colspan="7" class="ad-empty">No users found.</td></tr>';
  }

  async function loadEvents() {
    const { events } = await api("events");
    const list = Array.isArray(events) ? events : [];
    const label = { signup: "Signed up", login: "Logged in" };
    $("adEvents").innerHTML = list.length
      ? list
          .map(
            (e) =>
              `<li class="${e.ok ? "" : "bad"}"><span>${esc(
                e.ok
                  ? label[e.kind] || e.kind.replace("admin:", "Admin: ")
                  : "Failed " + e.kind,
              )}</span> <b>${esc(e.email || "unknown")}</b><small>${fmt(e.at)} · ${esc(e.ip)}</small></li>`,
          )
          .join("")
      : '<li class="ad-empty">No activity yet.</li>';
  }

  const panels = [
    {
      name: "Summary",
      load: loadOverview,
      empty: () =>
        ($("adChart").innerHTML = '<p class="ad-empty">Not loaded.</p>'),
    },
    {
      name: "Users",
      load: loadUsers,
      empty: () =>
        ($("adUsers").innerHTML =
          '<tr><td colspan="7" class="ad-empty">Not loaded.</td></tr>'),
    },
    {
      name: "Activity",
      load: loadEvents,
      empty: () =>
        ($("adEvents").innerHTML = '<li class="ad-empty">Not loaded.</li>'),
    },
  ];

  async function refresh() {
    showMsg("");
    // Settled, not Promise.all: one dead endpoint used to blank every panel and
    // leave a single line of text, which looked like a broken dashboard.
    const settled = await Promise.allSettled(panels.map((p) => p.load()));
    const bad = [];
    settled.forEach((s, i) => {
      if (s.status !== "rejected" || s.reason.message === "login") return;
      panels[i].empty();
      bad.push(panels[i].name + ": " + hint(s.reason));
    });
    if (bad.length) showMsg(bad.join(" · "));
  }

  $("adUsers").addEventListener("click", async (ev) => {
    const b = ev.target.closest("button[data-act]");
    if (!b) return;
    if (
      b.dataset.act === "delete" &&
      !confirm(`Delete ${b.dataset.name}? This can't be undone.`)
    )
      return;
    b.disabled = true;
    try {
      await api("users/" + b.dataset.id, {
        method: "POST",
        body: JSON.stringify({ action: b.dataset.act }),
      });
      await refresh();
    } catch (e) {
      showMsg(hint(e));
      b.disabled = false;
    }
  });

  let t;
  $("adSearch").addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      loadUsers().catch((e) => {
        if (e.message === "login") return;
        panels[1].empty();
        showMsg(hint(e));
      });
    }, 250);
  });

  fetch("/api/auth/me/", { credentials: "same-origin" })
    .then((r) => r.json())
    .then((d) => {
      if (d.user) $("adMe").textContent = d.user.email;
    })
    .catch(() => {});
  refresh();
})();

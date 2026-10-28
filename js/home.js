// Home page extras: activity calendar, weakest cards, resume, Ask Corvus, stat deltas.
Object.assign(app, {
  renderHomeExtras() {
    if (!document.getElementById("hdCal")) return;
    this.renderActivityCalendar();
    this.setupCalendarTap();
    this.renderWeakCards();
    this.renderResume();
    this.renderStatDeltas();
  },

  renderActivityCalendar() {
    const el = document.getElementById("hdCal");
    const hist = this.stats.studyHistory || {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // 12 full weeks ending with this week's Saturday, columns = weeks.
    const end = new Date(today);
    end.setDate(end.getDate() + (6 - end.getDay()));
    const start = new Date(end);
    start.setDate(start.getDate() - 12 * 7 + 1);
    let html = "";
    let total = 0;
    let activeDays = 0;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const n = hist[d.toDateString()] || 0;
      const future = d > today;
      if (!future) {
        total += n;
        if (n) activeDays++;
      }
      const lvl = n === 0 ? 0 : n < 5 ? 1 : n < 15 ? 2 : n < 30 ? 3 : 4;
      const label = d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      const tip = `${label}: ${n} card${n === 1 ? "" : "s"}`;
      html += `<i class="l${lvl}${d.getTime() === today.getTime() ? " today" : ""}"${
        future
          ? ' style="visibility:hidden"'
          : ` tabindex="0" aria-label="${tip}" data-tip="${tip}" title="${tip}"`
      }></i>`;
    }
    el.innerHTML = html;
    document.getElementById("hdCalSummary").textContent =
      `${total} reviews · ${activeDays} active day${activeDays === 1 ? "" : "s"}`;
  },

  // Phones have no hover, so the per-day tooltip a mouse user gets for free has to
  // come out on tap (and on keyboard focus) into a caption under the grid.
  setupCalendarTap() {
    const cal = document.getElementById("hdCal");
    const out = document.getElementById("hdCalTip");
    if (!cal || !out || cal._tapBound) return;
    cal._tapBound = true;
    const show = (tip) => {
      out.textContent = tip || "";
      out.hidden = !tip;
    };
    const cell = (t) =>
      t && t.tagName === "I" && t.dataset.tip ? t : null;
    cal.addEventListener("click", (e) => {
      const c = cell(e.target);
      if (c) show(c.dataset.tip);
    });
    // Mouse users get the browser tooltip, but it takes a second to appear;
    // the caption responds immediately instead.
    cal.addEventListener("mouseover", (e) => {
      const c = cell(e.target);
      if (c) show(c.dataset.tip);
    });
    cal.addEventListener("focusin", (e) => {
      const c = cell(e.target);
      if (c) show(c.dataset.tip);
    });
    cal.addEventListener("focusout", () => show(""));
    cal.addEventListener("mouseleave", () => show(""));
  },

  weakestCards(n = 5) {
    return this.flashcards
      .filter((c) => (c.mastery || 0) < 3)
      .sort(
        (a, b) =>
          (a.mastery || 0) - (b.mastery || 0) ||
          (a.ease || 2.5) - (b.ease || 2.5) ||
          (a.nextReview || 0) - (b.nextReview || 0),
      )
      .slice(0, n);
  },

  renderWeakCards() {
    const list = document.getElementById("hdWeakList");
    const btn = document.getElementById("hdWeakBtn");
    const weak = this.weakestCards(5);
    const levels = ["New", "Learning", "Review", "Mastered"];
    list.innerHTML = weak.length
      ? weak
          .map(
            (c) =>
              `<li><span>${this.escapeHtml(c.term)}</span><small>${levels[c.mastery || 0]}${
                c.category ? " · " + this.escapeHtml(c.category) : ""
              }</small></li>`,
          )
          .join("")
      : '<li><span class="hd-muted">Everything is mastered. Nice work!</span></li>';
    btn.disabled = !weak.length;
    btn.onclick = () => this.studyCards(weak.map((c) => c.id));
  },

  // Start a study session with exactly these cards.
  studyCards(ids) {
    const cards = ids
      .map((id) => this.flashcards.find((c) => c.id === id))
      .filter(Boolean);
    if (!cards.length) return;
    this.showSection("study");
    this.startStudy();
    this.studyQueue = cards;
    this.currentStudyIndex = 0;
    this.studyReversed = cards.map(() => this.pickReversed());
    this.showStudyCard();
  },

  // ---------- Continue where you left off ----------
  saveStudyProgress() {
    try {
      const q = this.studyQueue || [];
      const i = this.currentStudyIndex || 0;
      if (!q.length || i >= q.length) {
        localStorage.removeItem("studyResume");
        return;
      }
      const cat = document.getElementById("studyCategory")?.value || "all";
      localStorage.setItem(
        "studyResume",
        JSON.stringify({
          ids: q.slice(i).map((c) => c.id),
          done: i,
          total: q.length,
          cat,
          at: Date.now(),
        }),
      );
    } catch {}
  },

  getStudyProgress() {
    try {
      const r = JSON.parse(localStorage.getItem("studyResume") || "null");
      if (!r || !Array.isArray(r.ids) || !r.ids.length) return null;
      if (Date.now() - r.at > 7 * 86400000) return null; // stale after a week
      return r;
    } catch {
      return null;
    }
  },

  renderResume() {
    const box = document.getElementById("hdResume");
    const r = this.getStudyProgress();
    box.hidden = !r || r.done === 0;
    if (box.hidden) return;
    const label = r.cat && r.cat !== "all" ? r.cat : "All categories";
    document.getElementById("hdResumeText").textContent =
      `${label}: ${r.done} of ${r.total} done`;
  },

  resumeStudy() {
    const r = this.getStudyProgress();
    if (r) this.studyCards(r.ids);
  },

  // ---------- Ask Corvus ----------
  askCorvusFromHome() {
    const box = document.getElementById("hdAskInput");
    const msg = box.value.trim();
    if (!msg) return box.focus();
    this.openChatHead();
    const input = document.getElementById("aiInput");
    if (input) {
      input.value = msg;
      this.sendAiMessage();
    }
    box.value = "";
  },

  // ---------- Stat changes this week ----------
  renderStatDeltas() {
    const set = (id, txt) => {
      const el = document.getElementById("delta_" + id);
      if (!el) return;
      el.textContent = txt || "—";
      el.classList.toggle("flat", !txt);
    };
    const weekAgo = Date.now() - 7 * 86400000;
    const added = this.flashcards.filter(
      (c) => (c.created || 0) >= weekAgo,
    ).length;
    set("totalCards", added ? `+${added} this week` : "");
    const hist = this.stats.studyHistory || {};
    let reviews = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      reviews += hist[d.toDateString()] || 0;
    }
    set("masteredCards", reviews ? `${reviews} reviews this week` : "");
    const s = this.stats.streak || 0;
    set("streakCount", s ? (s >= 7 ? "On fire!" : "Keep it going") : "");
    set("studyTime", "");
  },
});

// Hook into existing flows after all scripts have loaded.
document.addEventListener("DOMContentLoaded", function () {
  const wrap = (name, after) => {
    const orig = app[name];
    if (typeof orig !== "function") return;
    app[name] = function (...args) {
      const r = orig.apply(this, args);
      try {
        after.call(this);
      } catch {}
      return r;
    };
  };
  wrap("renderHomeDashboard", function () {
    this.renderHomeExtras();
  });
  wrap("rateCard", function () {
    this.saveStudyProgress();
  });
  wrap("nextStudyCard", function () {
    this.saveStudyProgress();
  });
});

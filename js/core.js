// Shared state, startup, storage and small helpers.
const app = {
  flashcards: [],
  selectedCards: new Set(),
  selectionMode: false,
  studyQueue: [],
  currentStudyIndex: 0,
  currentQuiz: null,
  quizType: "multiple",
  quizScore: 0,
  quizStreak: 0,
  quizAnswered: false,
  stats: {
    totalReviews: 0,
    correctAnswers: 0,
    responseTimes: [],
    studyTimeMs: 0,
    studyHistory: {},
    streak: 0,
    lastStudyDate: null,
    dailyGoal: 20,
    dailyReviewed: 0,
    codePracticed: 0,
    codeCorrect: 0,
  },

  codeItems: [],
  codePracticePool: [],
  codePracticeIndex: 0,
  codeRevealed: false,

  // Which side is asked first: "term", "def" or "mixed" (random per card).
  cardDirection: "term",

  setCardDirection(dir, silent) {
    if (!["term", "def", "mixed"].includes(dir)) dir = "term";
    this.cardDirection = dir;
    try {
      localStorage.setItem("cardDirection", dir);
    } catch {}
    ["studyDirection", "quizDirection"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = dir;
    });
    // Restart an open study session so the new direction applies right away.
    if (
      !silent &&
      this.studyQueue &&
      this.studyQueue.length &&
      document.getElementById("study")?.classList.contains("active")
    ) {
      this.startStudy();
    }
  },

  // Resolve the direction for one card: true = show definition first.
  pickReversed() {
    if (this.cardDirection === "def") return true;
    if (this.cardDirection === "mixed") return Math.random() < 0.5;
    return false;
  },

  // Forgiving comparison for typed answers.
  normAnswer(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[.,;:!?"'()]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^(the|a|an) /, "");
  },

  // ---------- Account / greeting ----------
  currentUser: null,

  async checkSession() {
    if (!location.protocol.startsWith("http")) return this.updateGreeting();
    try {
      const r = await fetch("/api/auth/me/", {
        credentials: "same-origin",
        signal: AbortSignal.timeout(5000),
      });
      if (r.status === 401) {
        location.replace(
          "user/login.html?next=" + encodeURIComponent(location.pathname),
        );
        return;
      }
      const data = await r.json();
      this.currentUser = data.user || null;
      if (this.currentUser) this.pullDeck();
      if (this.currentUser?.admin && !document.getElementById("adminLink")) {
        const a = document.createElement("a");
        a.id = "adminLink";
        a.href = "/admin.html";
        a.className = "prefs-toggle";
        a.title = a.ariaLabel = "Admin dashboard";
        a.innerHTML = '<i class="material-icons">admin_panel_settings</i>';
        document.querySelector(".action-btn")?.prepend(a);
      }
    } catch {
      // Server unreachable (offline): keep the app usable without a name.
    }
    this.updateGreeting();
  },

  updateGreeting() {
    const el = document.getElementById("homeGreeting");
    if (!el) return;
    const h = new Date().getHours();
    const part =
      h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    const first = (this.currentUser?.name || "").trim().split(/\s+/)[0];
    // textContent keeps any HTML in a name from being run.
    el.textContent = first ? `${part}, ${first}!` : `${part}!`;
  },

  async logout() {
    try {
      await fetch("/api/auth/logout/", {
        method: "POST",
        credentials: "same-origin",
      });
    } catch {}
    location.replace("user/login.html");
  },

  init() {
    this.checkSession();
    this.loadData();
    // Seed only on a genuinely first run; an emptied deck must stay empty.
    if (this.lsGet("flashcards") === null && this.flashcards.length === 0) {
      this.seedSampleCards();
      // Remembering the sample ids lets a signed-in pull replace them instead of
      // syncing them into the account's real deck.
      this.lsSet(
        "deckSeed",
        JSON.stringify(this.flashcards.map((c) => c.id)),
      );
    }
    // The daily goal has to roll over before the home screen paints it.
    this.updateDailyGoal();
    this.updateUI();
    this.setupTheme();
    this.setupKeyboard();
    this.setupDragDrop();
    this.rotateTip();
    this.checkAiStatus();
    this.setupTextSizeSlider();
    this.setCardDirection(this.lsGet("cardDirection", "term"), true);
    this._chatOutside = (ev) => {
      const panel = document.getElementById("chatPanel");
      const head = document.getElementById("chatHead");
      if (
        panel &&
        panel.classList.contains("open") &&
        !panel.contains(ev.target) &&
        !(head && head.contains(ev.target))
      ) {
        this.closeChatHead();
      }
    };
    document.addEventListener("click", this._chatOutside);
    // A queued push must not die with a tab that goes to the background.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.flushDeck();
    });
    // Two tabs share one localStorage, and only one of them owns the server copy.
    // Adopting what the other tab saved stops a stale in-memory deck from being
    // pushed out to every device.
    window.addEventListener("storage", (e) => {
      if (e.key !== "flashcards" || this._pushing || this._syncing) return;
      this.loadData();
      this.updateUI();
    });
    const params = new URLSearchParams(location.search);
    if (params.has("nocache")) {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.getRegistrations().then((regs) => {
          regs.forEach((r) => r.unregister());
        });
      }
      if (window.caches) {
        caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
      }
    }
    if (
      "serviceWorker" in navigator &&
      location.protocol.startsWith("http") &&
      !params.has("nocache")
    ) {
      window.addEventListener("load", () => {
        navigator.serviceWorker
          .register("sw.js")
          .then((reg) => {
            reg.addEventListener("updatefound", () => {
              const nw = reg.installing;
              if (!nw) return;
              nw.addEventListener("statechange", () => {
                if (
                  nw.state === "installed" &&
                  navigator.serviceWorker.controller
                ) {
                  this.notify(
                    "New version available — reload to update",
                    "success",
                  );
                }
              });
            });
          })
          .catch(() => {});
      });
    }
    if (params.has("dev")) {
      const btn = document.getElementById("devClearCache");
      if (btn) btn.style.display = "flex";
    }
  },

  loadData() {
    // One key per try: a corrupt stats or codeItems entry must not blank the deck,
    // because an empty deck is reseeded and then saved over the real cards.
    this.flashcards = this.asArray(this.lsJson("flashcards", []));
    this.stats = { ...this.stats, ...this.lsJson("studyStats", {}) };
    this.codeItems = this.asArray(this.lsJson("codeItems", []));
    this.updateStreak();
  },

  asArray(value) {
    return Array.isArray(value) ? value : [];
  },

  saveData() {
    try {
      localStorage.setItem("flashcards", JSON.stringify(this.flashcards));
      localStorage.setItem("studyStats", JSON.stringify(this.stats));
      localStorage.setItem("codeItems", JSON.stringify(this.codeItems));
    } catch (e) {
      console.error("Error saving data:", e);
      if (!this._saveWarned) {
        this._saveWarned = true;
        this.notify(
          "Could not save - browser storage is full. Export your cards as a backup.",
          "error",
        );
      }
    }
    this.queuePush();
  },

  // ---------- Deck sync (one flashcard set per account) ----------
  // localStorage stays the working copy, so studying offline keeps working; the
  // server copy exists only so another device on this account loads the cards.
  _deckReady: false,
  _pushTimer: null,
  _pushing: false,
  _syncing: false,

  deckDeleted() {
    const d = this.lsJson("deckDeleted", {});
    return d && typeof d === "object" && !Array.isArray(d) ? d : {};
  },

  // Non-cryptographic string hash: only used to spot which cards changed.
  hashOf(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  },

  cardHash(c) {
    const { updatedAt, ...rest } = c;
    return this.hashOf(JSON.stringify(rest));
  },

  cardStamp(c) {
    return Number(c && (c.updatedAt || c.created)) || 0;
  },

  // Stamp cards that changed since the last exchange and record the ids that
  // disappeared, so a delete on one device survives the merge on another.
  stampDeck() {
    const base = this.lsJson("deckBase", {}) || {};
    const deleted = this.deckDeleted();
    const next = {};
    const at = Date.now();
    let changed = false;

    for (const c of this.flashcards) {
      if (!c || typeof c.id !== "string" || !c.id) continue;
      const h = this.cardHash(c);
      const prev = base[c.id];
      if (prev && prev.startsWith(h + "|")) {
        next[c.id] = prev;
        continue;
      }
      c.updatedAt = at;
      next[c.id] = h + "|" + at;
      delete deleted[c.id];
      changed = true;
    }
    for (const id of Object.keys(base)) {
      if (!next[id]) {
        deleted[id] = at;
        changed = true;
      }
    }
    // Tombstones only have to outlive the longest offline stretch.
    for (const id of Object.keys(deleted)) {
      if (next[id] || at - Number(deleted[id]) > 60 * 864e5) delete deleted[id];
    }
    return {
      changed,
      base: JSON.stringify(next),
      deleted: JSON.stringify(deleted),
      body: JSON.stringify({ cards: this.flashcards, deleted }),
    };
  },

  commitDeck(st) {
    this.lsSet("deckBase", st.base);
    this.lsSet("deckDeleted", st.deleted);
  },

  deckSig(cards) {
    return this.hashOf(
      cards.map((c) => c.id + ":" + this.cardStamp(c)).sort().join("|"),
    );
  },

  mergeDeck(remote) {
    const remoteCards = this.asArray(remote.cards).filter(
      (c) => c && typeof c.id === "string",
    );
    const remoteDeleted =
      remote.deleted && typeof remote.deleted === "object"
        ? remote.deleted
        : {};
    const deleted = {};
    for (const src of [remoteDeleted, this.deckDeleted()]) {
      for (const [id, ts] of Object.entries(src)) {
        const t = Number(ts) || 0;
        if (!deleted[id] || t > deleted[id]) deleted[id] = t;
      }
    }
    const byId = new Map(remoteCards.map((c) => [c.id, c]));
    for (const c of this.flashcards) {
      if (!c || typeof c.id !== "string") continue;
      const other = byId.get(c.id);
      if (!other || this.cardStamp(c) >= this.cardStamp(other)) {
        byId.set(c.id, c);
      }
    }
    for (const [id, t] of Object.entries(deleted)) {
      const c = byId.get(id);
      if (c && t >= this.cardStamp(c)) byId.delete(id);
    }
    return { cards: [...byId.values()], deleted, remoteCards };
  },

  async pullDeck() {
    let r;
    try {
      r = await fetch("/api/deck/", {
        credentials: "same-origin",
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      this._deckReady = true;
      return;
    }
    this._deckReady = true;
    if (!r.ok) return;
    const remote = await r.json().catch(() => null);
    if (!remote || !Array.isArray(remote.cards)) return;

    const seeded = this.lsJson("deckSeed", null);
    const untouchedSeed =
      Array.isArray(seeded) &&
      seeded.length > 0 &&
      this.flashcards.every((c) => seeded.includes(c.id));
    const remoteDeleted =
      remote.deleted && typeof remote.deleted === "object" ? remote.deleted : {};

    let cards, deleted, push;
    if (remote.cards.length && untouchedSeed) {
      // New device: the account's deck replaces the samples outright, and there
      // is nothing local worth sending back.
      cards = remote.cards;
      deleted = remoteDeleted;
      push = false;
    } else {
      const m = this.mergeDeck(remote);
      cards = m.cards;
      deleted = m.deleted;
      push =
        this.deckSig(cards) !== this.deckSig(m.remoteCards) ||
        Object.keys(deleted).sort().join(",") !==
          Object.keys(remoteDeleted).sort().join(",");
    }

    this._syncing = true;
    try {
      this.flashcards = cards;
      const base = {};
      for (const c of this.flashcards) {
        if (c && typeof c.id === "string" && c.id) {
          base[c.id] = this.cardHash(c) + "|" + this.cardStamp(c);
        }
      }
      this.lsSet("deckBase", JSON.stringify(base));
      this.lsSet("deckDeleted", JSON.stringify(deleted));
      this.lsSet("flashcards", JSON.stringify(this.flashcards));
      this.updateUI();
    } finally {
      this._syncing = false;
    }
    if (push) this.queuePush(400);
  },

  queuePush(delay = 2000) {
    if (!this.currentUser || !this._deckReady || this._syncing) return;
    clearTimeout(this._pushTimer);
    this._pushTimer = setTimeout(() => this.pushDeck(), delay);
  },

  async pushDeck() {
    clearTimeout(this._pushTimer);
    this._pushTimer = null;
    if (!this.currentUser || this._pushing || this._syncing) return;
    const st = this.stampDeck();
    if (!st.changed) return;
    this.lsSet("flashcards", JSON.stringify(this.flashcards));
    this._pushing = true;
    let ok = false;
    try {
      const r = await fetch("/api/deck/", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: st.body,
        signal: AbortSignal.timeout(15000),
      });
      ok = r.ok;
      if (!ok && !this._pushWarned) {
        this._pushWarned = true;
        this.notify("Deck did not sync to the server: " + r.status, "error");
      }
    } catch {
      // Offline or server down: the local deck is already saved.
    } finally {
      this._pushing = false;
    }
    if (ok) {
      this.commitDeck(st);
    } else {
      this.queuePush(20000);
    }
  },

  flushDeck() {
    if (!this._pushTimer || !this.currentUser || !this._deckReady) return;
    const st = this.stampDeck();
    if (!st.changed) return;
    if (!navigator.sendBeacon) return;
    // A beacon that the server refuses leaves nothing to react to, so a deck near
    // the 2 MB proxy limit stays on the fetch path, which retries and reports.
    if (st.body.length > 1500000) return;
    const sent = navigator.sendBeacon(
      "/api/deck/",
      new Blob([st.body], { type: "application/json" }),
    );
    if (sent) {
      clearTimeout(this._pushTimer);
      this._pushTimer = null;
      this.commitDeck(st);
    }
  },

  // Storage access can throw (blocked site data, private mode), so every read and
  // write goes through these instead of raw localStorage.
  lsGet(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : raw;
    } catch {
      return fallback;
    }
  },

  lsJson(key, fallback) {
    const raw = this.lsGet(key);
    if (raw === null) return fallback;
    try {
      const parsed = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (e) {
      console.error("Corrupt value for " + key + ":", e);
      return fallback;
    }
  },

  lsSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  },

  lsRemove(key) {
    try {
      localStorage.removeItem(key);
    } catch {}
  },

  dayDiff(fromDateString, toDateString) {
    // Round so a 23h/25h day around daylight-saving changes still counts as 1.
    return Math.round(
      (new Date(toDateString) - new Date(fromDateString)) / 86400000,
    );
  },

  shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  },
};

window.app = app;

Object.assign(app, {
  seedSampleCards(silent = false) {
    const samples = [
      {
        term: "Photosynthesis",
        definition:
          "The process by which plants convert sunlight, water, and CO₂ into glucose and oxygen.",
        category: "Biology",
        tags: ["plants", "energy"],
      },
      {
        term: "Mitosis",
        definition:
          "Cell division that produces two identical daughter cells through prophase, metaphase, anaphase, and telophase.",
        category: "Biology",
        tags: ["cells", "division"],
      },
      {
        term: "Democracy",
        definition:
          "A system of government where citizens exercise power through voting, either directly or via representatives.",
        category: "History",
        tags: ["government", "politics"],
      },
      {
        term: "Newton's First Law",
        definition:
          "An object at rest stays at rest and an object in motion stays in motion unless acted on by an external force.",
        category: "Physics",
        tags: ["motion", "forces"],
      },
      {
        term: "HTML",
        definition:
          "HyperText Markup Language, the standard language used to structure and present content on the web.",
        category: "Computer Science",
        tags: ["web", "markup"],
      },
      {
        term: "Spaced Repetition",
        definition:
          "A learning technique that reviews information at increasing intervals to strengthen long-term memory.",
        category: "Study Skills",
        tags: ["memory", "learning"],
      },
    ];
    const now = Date.now();
    this.flashcards = samples.map((s, i) => ({
      id: `seed-${i}-${now}`,
      term: s.term,
      definition: s.definition,
      category: s.category,
      tags: s.tags,
      mastery: 0,
      nextReview: now,
      interval: 1,
      ease: 2.5,
      reviews: 0,
      created: now,
    }));
    this.saveData();
    if (!silent) this.notify("Loaded a sample deck to get you started!");
  },

  setupTheme() {
    const theme = this.lsGet("theme", "light");
    document.documentElement.setAttribute("data-theme", theme);
    document.getElementById("themeToggle").innerHTML =
      theme === "dark"
        ? '<img class="dark" src="assets/images/moon.png">'
        : '<img class="light" src="assets/images/sunn.png">';

    document.getElementById("themeToggle").onclick = () => {
      const current = document.documentElement.getAttribute("data-theme");
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      this.lsSet("theme", next);
      document.getElementById("themeToggle").innerHTML =
        next === "dark"
          ? '<img class="dark" src="assets/images/moon.png">'
          : '<img class="light" src="assets/images/sunn.png">';
    };
  },

  setupKeyboard() {
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (document.getElementById("chatPanel")?.classList.contains("open"))
          this.closeChatHead();
        if (document.getElementById("prefsModal")?.classList.contains("active"))
          this.closePrefs();
      }
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")
        return;
      const section = document.querySelector(".section.active")?.id;
      if (section === "study") {
        if (e.code === "Space") {
          e.preventDefault();
          this.flipCard();
        }
        if (e.key === "ArrowLeft") this.prevStudyCard();
        if (e.key === "ArrowRight") this.nextStudyCard();
        if (e.key === "1") this.rateCard(0);
        if (e.key === "2") this.rateCard(1);
        if (e.key === "3") this.rateCard(2);
        if (e.key === "4") this.rateCard(3);
      }
    });
    document.addEventListener("fullscreenchange", () => {
      if (!document.fullscreenElement) {
        document.body.classList.remove("focus-mode");
        const btn = document.getElementById("studyFocusBtn");
        if (btn) btn.textContent = "⛶ Focus";
      }
    });
  },

  setupDragDrop() {
    const zone = document.getElementById("importZone");
    if (!zone) return;
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      zone.style.borderColor = "var(--primary)";
    });
    zone.addEventListener("dragleave", () => {
      zone.style.borderColor = "";
    });
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.style.borderColor = "";
      const file = e.dataTransfer.files[0];
      if (file) this.readFile(file);
    });
  },

  readFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        this.importCards(data);
      } catch (err) {
        this.notify("Invalid JSON file", "error");
      }
    };
    reader.readAsText(file);
  },

  showSection(id) {
    if (id === "ai") {
      this.openChatHead();
      return;
    }
    document
      .querySelectorAll(".section")
      .forEach((s) => s.classList.remove("active"));
    document.getElementById(id)?.classList.add("active");
    document.querySelectorAll(".nav-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.section === id);
    });
    document.querySelectorAll(".bottom-nav-item").forEach((b) => {
      const isActive = b.dataset.section === id;
      b.classList.toggle("active", isActive);
      if (isActive) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (id !== "study" && document.body.classList.contains("focus-mode")) {
      this.exitFocusMode();
    }
    if (id !== "study" && this._timerId) {
      clearTimeout(this._timerId);
      this._timerId = null;
      this.studySessionStart = null;
    }
    if (id !== "quiz") this.clearQuizTimer();
    if (id === "study") this.startStudy();
    if (id === "stats") this.updateStats();
    if (id === "code") this.renderCodeList();
    if (id === "home") {
      this.updateHomeStats();
      this.rotateMascotMessage();
    }
  },

  backQuiz() {
    document.getElementById("tabNav").style.display = "flex";
    document.getElementById("quizSetup").style.display = "block";
    document.getElementById("quizActive").style.display = "none";
    document.getElementById("quizResults").style.display = "none";
    document.getElementById("backHome").style.display = "none";
    document.getElementById("sectionHidden").style.display = "block";
  },

  updateUI() {
    this.renderFlashcardList();
    this.updateCategoryFilters();
    this.updateStudyCategories();
    this.populateCategorySelect();
    this.populateQuizCategories();
    this.updateHomeStats();
  },

  closePrefs() {
    const quickActive = document.getElementById("prefsModal");
    if (quickActive) quickActive.classList.remove("active");
  },

  togglePrefs() {
    const modal = document.getElementById("prefsModal");
    if (!modal) return;
    if (modal.classList.contains("active")) this.closePrefs();
    else this.openPrefs();
  },

  openPrefs() {
    const modal = document.getElementById("prefsModal");
    if (!modal) return;
    modal.classList.add("active");
    this._syncPrefsUI();
    this.renderPrefsCategories();
  },

  async clearCacheAndReload() {
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch (e) {}
    location.reload();
  },

  _syncPrefsUI() {
    this._setSliderIndex && this._setSliderIndex(this._textSizeIndex(), true);
  },

  // ---------- Text size (4 stops) ----------
  TEXT_SIZES: [
    { key: "sm", label: "Small" },
    { key: "md", label: "Normal" },
    { key: "lg", label: "Large" },
    { key: "xl", label: "Extra large" },
  ],

  _textSizeIndex() {
    const saved = this.lsGet("prefsTextSize", "md");
    const i = this.TEXT_SIZES.findIndex((s) => s.key === saved);
    return i < 0 ? 1 : i;
  },

  setPrefTextSize(size) {
    if (!this.TEXT_SIZES.some((s) => s.key === size)) size = "md";
    document.documentElement.dataset.textSize = size;
    this.lsSet("prefsTextSize", size);
  },

  setupTextSizeSlider() {
    const stops = this.TEXT_SIZES;
    const n = stops.length;
    const slider = document.getElementById("slider");
    const dotsEl = document.getElementById("dots");
    const labelsEl = document.getElementById("labels");
    const start = this._textSizeIndex();
    this.setPrefTextSize(stops[start].key);
    if (!slider || !dotsEl || !labelsEl) return;
    let idx = -1;
    let dragging = false;
    slider.setAttribute("aria-valuemax", n - 1);
    dotsEl.innerHTML = "";
    labelsEl.innerHTML = "";
    stops.forEach((s, i) => {
      const pct = (i / (n - 1)) * 100;
      const d = document.createElement("div");
      d.className = "dot";
      d.style.left = pct + "%";
      dotsEl.appendChild(d);
      const b = document.createElement("button");
      b.type = "button";
      b.className = "lb";
      b.textContent = s.label;
      b.style.left = pct + "%";
      b.addEventListener("click", () => setIndex(i));
      labelsEl.appendChild(b);
    });
    const setIndex = (i, silent) => {
      const next = Math.max(0, Math.min(n - 1, i));
      const changed = next !== idx;
      idx = next;
      const pct = (idx / (n - 1)) * 100;
      document.getElementById("thumb").style.left = pct + "%";
      document.getElementById("fill").style.width = `calc(${pct}% + 6px)`;
      document.getElementById("value").textContent = stops[idx].label;
      slider.setAttribute("aria-valuenow", idx);
      slider.setAttribute("aria-valuetext", stops[idx].label);
      [...dotsEl.children].forEach((d, k) =>
        d.classList.toggle("on", k <= idx),
      );
      [...labelsEl.children].forEach((b, k) =>
        b.classList.toggle("on", k === idx),
      );
      if (changed && !silent) this.setPrefTextSize(stops[idx].key);
    };
    this._setSliderIndex = setIndex;
    const fromX = (x) => {
      const r = slider.getBoundingClientRect();
      if (r.width) setIndex(Math.round(((x - r.left) / r.width) * (n - 1)));
    };
    const end = () => {
      dragging = false;
      slider.classList.remove("dragging");
    };
    slider.addEventListener("pointerdown", (e) => {
      dragging = true;
      slider.classList.add("dragging");
      slider.setPointerCapture(e.pointerId);
      fromX(e.clientX);
    });
    slider.addEventListener("pointermove", (e) => dragging && fromX(e.clientX));
    slider.addEventListener("pointerup", end);
    slider.addEventListener("pointercancel", end);
    slider.addEventListener("keydown", (e) => {
      const k = e.key;
      if (k === "ArrowRight" || k === "ArrowUp") setIndex(idx + 1);
      else if (k === "ArrowLeft" || k === "ArrowDown") setIndex(idx - 1);
      else if (k === "Home") setIndex(0);
      else if (k === "End") setIndex(n - 1);
      else return;
      e.preventDefault();
    });
    setIndex(start, true);
  },

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  },

  jsArg(str) {
    return this.escapeHtml(JSON.stringify(str)).replace(/"/g, "&quot;");
  },

  escAttr(str) {
    return this.escapeHtml(String(str)).replace(/"/g, "&quot;");
  },

  //switchcodetab

  resetAllData() {
    ["flashcards", "studyStats", "codeItems", "studyResume"].forEach((key) =>
      this.lsRemove(key),
    );
    this.flashcards = [];
    this.codeItems = [];
    this.selectedCards = new Set();
    this.selectionMode = false;
    this.stats = {
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
    };
    this.seedSampleCards(true);
    this.updateDailyGoal();
    this.updateUI();
    this.updateHomeStats();
    this.closeModal("resetModal");
  },

  notify(msg, type = "success") {
    const n = document.getElementById("notification");
    n.textContent = msg;
    n.style.background = type === "error" ? "var(--danger)" : "var(--success)";
    n.classList.add("show");
    setTimeout(() => n.classList.remove("show"), 3000);
  },
});

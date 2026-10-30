Object.assign(app, {
  updateStudyCategories() {
    const select = document.getElementById("studyCategory");
    if (!select) return;
    const selected = select.value;
    const categories = [
      ...new Set(this.flashcards.map((c) => c.category).filter(Boolean)),
    ];
    select.innerHTML =
      `<option value="all">All categories</option>` +
      categories
        .map(
          (c) =>
            `<option value="${this.escAttr(c)}">${this.escapeHtml(c)}</option>`,
        )
        .join("");
    if (categories.includes(selected)) select.value = selected;
  },

  populateCategorySelect() {
    const select = document.getElementById("cardCategory");
    if (!select) return;
    const cats = [
      ...new Set(this.flashcards.map((c) => c.category).filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b));
    const current = select.value;
    select.innerHTML =
      `<option value="">Select category...</option>` +
      cats
        .map(
          (c) =>
            `<option value="${this.escAttr(c)}">${this.escapeHtml(c)}</option>`,
        )
        .join("") +
      `<option value="__new__">+ Add new category...</option>`;
    if (cats.includes(current)) select.value = current;
  },

  onCardCategoryChange() {
    const select = document.getElementById("cardCategory");
    const input = document.getElementById("cardCategoryNew");
    if (select.value === "__new__") {
      input.style.display = "block";
      input.focus();
    } else {
      input.style.display = "none";
      input.value = "";
    }
  },

  onCategoryModalChange() {
    const select = document.getElementById("categorySelect");
    const input = document.getElementById("categorySelectNew");
    if (select.value === "__new__") {
      input.style.display = "block";
      input.focus();
    } else {
      input.style.display = "none";
      input.value = "";
    }
  },

  populateQuizCategories() {
    const select = document.getElementById("quizCategory");
    if (!select) return;
    const cats = [
      ...new Set(this.flashcards.map((c) => c.category).filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b));
    select.innerHTML =
      `<option value="all">All categories</option>` +
      cats
        .map(
          (c) =>
            `<option value="${this.escAttr(c)}">${this.escapeHtml(c)}</option>`,
        )
        .join("");
  },

  // ---------- Home (mobile): today's session ----------
  renderHomeDashboard() {
    const $ = (id) => document.getElementById(id);
    if (!$("hdSession")) return;
    $("homeDate").textContent = new Date()
      .toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      })
      .toUpperCase();
    const streak = this.stats.streak || 0;
    $("hdStreak2").textContent = streak;
    if ($("hdStreakBadge")) $("hdStreakBadge").textContent = streak;

    const cards = this.flashcards;
    const now = Date.now();
    const due = cards.filter((c) => !c.nextReview || c.nextReview <= now);
    const rt = (this.stats.responseTimes || []).slice(-50);
    const avgSec = rt.length
      ? rt.reduce((a, b) => a + b, 0) / rt.length / 1000
      : 30;
    const mins = Math.max(
      1,
      Math.round((due.length * Math.min(Math.max(avgSec, 5), 120)) / 60),
    );
    const goal = this.stats.dailyGoal || 20;
    const done = this.stats.dailyReviewed || 0;
    $("hdSessionBar").style.width = Math.min(100, (done / goal) * 100) + "%";
    $("hdSessionGoal").textContent = `${done} / ${goal} daily goal`;

    // Category with the most weak or due cards.
    const weak = {};
    cards.forEach((c) => {
      if ((c.mastery || 0) < 2 || !c.nextReview || c.nextReview <= now) {
        const k = c.category || "";
        weak[k] = (weak[k] || 0) + 1;
      }
    });
    const top = Object.entries(weak)
      .filter(([k]) => k)
      .sort((a, b) => b[1] - a[1])[0];
    const focus = $("hdSessionFocus");
    const btn = $("hdSessionBtn");

    if (!cards.length) {
      $("hdSessionMeta").textContent = "Your deck is empty.";
      focus.hidden = true;
      btn.textContent = "Add your first card";
      btn.onclick = () => this.showAddCardModal();
    } else if (!due.length) {
      $("hdSessionMeta").textContent = "All caught up!";
      focus.hidden = true;
      btn.textContent = "Quick quiz (5 questions)";
      btn.onclick = () => {
        this.showSection("quiz");
        const n = document.getElementById("quizCount");
        if (n) n.value = 5;
        this.startQuiz();
      };
    } else {
      $("hdSessionMeta").textContent =
        `${due.length} card${due.length === 1 ? "" : "s"} · about ${mins} min`;
      if (top) {
        focus.hidden = false;
        focus.textContent = `Focus: ${top[0]} (${top[1]} weak card${top[1] === 1 ? "" : "s"}) ›`;
        focus.onclick = () => this.startStudyIn(top[0]);
      } else focus.hidden = true;
      btn.innerHTML = '<i class="material-icons">play_arrow</i> Start studying';
      btn.onclick = () => this.startStudyIn("all");
    }
    $("statsMascotMsg").textContent = this.statsMascotLine(due.length);
  },

  startStudyIn(category) {
    this.showSection("study");
    const sel = document.getElementById("studyCategory");
    if (sel && [...sel.options].some((o) => o.value === category))
      sel.value = category;
    this.startStudy();
  },

  statsMascotLine(dueCount) {
    const s = this.stats;
    const total = this.flashcards.length;
    const acc = s.totalReviews
      ? Math.round((s.correctAnswers / s.totalReviews) * 100)
      : null;
    if (!total) return "An empty deck! Let's add your first card.";
    if (dueCount)
      return `${dueCount} card${dueCount === 1 ? "" : "s"} due — let's go!`;
    if (acc !== null && acc >= 85) return `${acc}% accuracy — scholar mode!`;
    if ((s.streak || 0) >= 3) return `${s.streak}-day streak. Keep it alive!`;
    if (acc !== null) return `${acc}% accuracy so far. Practice sharpens it.`;
    return "Nothing due. A quick quiz keeps it fresh.";
  },

  updateHomeStats() {
    document.getElementById("totalCards").textContent = this.flashcards.length;
    const mastered = this.flashcards.filter((c) => c.mastery >= 3).length;
    document.getElementById("masteredCards").textContent = mastered;
    document.getElementById("streakCount").textContent = this.stats.streak;
    const totalSec = Math.floor(this.stats.studyTimeMs / 1000);
    const totalMin = Math.floor(totalSec / 60);
    document.getElementById("studyTime").textContent =
      totalMin < 60
        ? `${totalMin}m`
        : `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`;
    this.renderHomeDashboard();
  },

  updateStreak() {
    const today = new Date().toDateString();
    const last = this.stats.lastStudyDate;
    if (!last) return;
    const diff = this.dayDiff(last, today);
    if (diff > 1) this.stats.streak = 0;
    this.saveData();
  },

  rotateTip() {
    const tips = [
      "Use spaced repetition to review cards just before you forget them.",
      "Try to recall the answer before flipping the card.",
      "Study in short, focused sessions for better retention.",
      "Teach concepts to others to strengthen your understanding.",
      "Connect new information to things you already know.",
      "Use mnemonics to remember lists or sequences.",
      "Get enough sleep - it helps consolidate memories.",
      "Take breaks between study sessions to avoid burnout.",
    ];
    const idx = Math.floor(Date.now() / 86400000) % tips.length;
    document.getElementById("dailyTip").textContent = tips[idx];
  },

  mascotLines: [
    "Hi! Ready to study?",
    "One card at a time — you've got this.",
    "Recall the answer before you flip the card.",
    "Short, focused sessions beat cramming.",
    "Your streak grows every time you review.",
    "Stuck? Try the Quiz mode to test yourself.",
    "Teaching it back is the fastest way to learn.",
    "Sleep on it — your brain remembers better tomorrow.",
    "DYK? Lauwak (lawak) means to expand",
    "Uwak translates to Crow — nature's one of the smartest animal.",
  ],
  mascotIndex: 0,

  rotateMascotMessage() {
    const el = document.getElementById("mascotMsg");
    if (!el) return;
    this.mascotIndex = (this.mascotIndex + 1) % this.mascotLines.length;
    el.textContent = this.mascotLines[this.mascotIndex];
    const bubble = el.closest(".mascot-bubble");
    if (bubble) {
      bubble.classList.remove("swap");
      void bubble.offsetWidth;
      bubble.classList.add("swap");
    }
  },

  updateDailyGoal() {
    const reviewed = this.stats.dailyReviewed || 0;
    const target = this.stats.dailyGoal || 20;
    const today = new Date().toDateString();
    if (this.stats.lastStudyDate !== today) {
      this.stats.dailyReviewed = 0;
    }
    const pct = Math.min(
      100,
      Math.round((this.stats.dailyReviewed / target) * 100),
    );
    document.getElementById("goalPercent").textContent = `${pct}%`;
    document.getElementById("goalCurrent").textContent =
      this.stats.dailyReviewed;
    document.getElementById("goalTargetNum").textContent = target;
    document.getElementById("goalTarget").textContent = target;
    const circumference = 2 * Math.PI * 36;
    document.getElementById("goalProgress").style.strokeDashoffset =
      circumference - (pct / 100) * circumference;
  },

  showCategoryModal(id) {
    const card = this.flashcards.find((c) => c.id === id);
    if (!card) return;
    document.getElementById("categoryCardId").value = id;
    const select = document.getElementById("categorySelect");
    const cats = [
      ...new Set(this.flashcards.map((c) => c.category).filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b));
    select.innerHTML =
      `<option value="">Select category...</option>` +
      cats
        .map(
          (c) =>
            `<option value="${this.escAttr(c)}">${this.escapeHtml(c)}</option>`,
        )
        .join("") +
      `<option value="__new__">+ Add new category</option>`;
    select.value = card.category || "";
    const newInput = document.getElementById("categorySelectNew");
    newInput.style.display = "none";
    newInput.value = "";
    document.getElementById("categoryModal").classList.add("active");
    select.focus();
  },

  showAddCardModal(editId) {
    document.getElementById("editCardId").value = editId || "";
    document.getElementById("modalTitle").textContent = editId
      ? "Edit Flashcard"
      : "Add New Flashcard";
    this.populateCategorySelect();
    const newInput = document.getElementById("cardCategoryNew");
    newInput.style.display = "none";
    newInput.value = "";
    if (editId) {
      const card = this.flashcards.find((c) => c.id === editId);
      if (card) {
        document.getElementById("cardTerm").value = card.term;
        document.getElementById("cardDefinition").value = card.definition;
        document.getElementById("cardCategory").value = card.category || "";
        document.getElementById("cardTags").value = (card.tags || []).join(
          ", ",
        );
      }
    } else {
      document.getElementById("cardTerm").value = "";
      document.getElementById("cardDefinition").value = "";
      document.getElementById("cardCategory").value = "";
      document.getElementById("cardTags").value = "";
    }
    document.getElementById("addCardModal").classList.add("active");
    document.getElementById("cardTerm").focus();
  },

  showImportModal() {
    document.getElementById("importModal").classList.add("active");
    document.getElementById("importData").focus();
  },

  closeModal(id) {
    document.getElementById(id).classList.remove("active");
  },

  saveCard() {
    const term = document.getElementById("cardTerm").value.trim();
    const definition = document.getElementById("cardDefinition").value.trim();
    let category = document.getElementById("cardCategory").value.trim();
    if (category === "__new__") {
      category = document.getElementById("cardCategoryNew").value.trim();
    }
    const tags = document
      .getElementById("cardTags")
      .value.split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    if (!term || !definition) {
      this.notify("Please fill in term and definition", "error");
      return;
    }

    const editId = document.getElementById("editCardId").value;
    if (editId) {
      const card = this.flashcards.find((c) => c.id === editId);
      if (card) {
        card.term = term;
        card.definition = definition;
        card.category = category;
        card.tags = tags;
      }
    } else {
      this.flashcards.push({
        id: Date.now().toString(),
        term,
        definition,
        category,
        tags,
        mastery: 0,
        nextReview: Date.now(),
        interval: 1,
        ease: 2.5,
        reviews: 0,
        created: Date.now(),
      });
    }

    this.saveData();
    this.updateUI();
    this.closeModal("addCardModal");
    this.notify(editId ? "Card updated!" : "Card created!");
  },

  saveCardCategory() {
    let category = document.getElementById("categorySelect").value;
    if (category === "__new__") {
      category = document.getElementById("categorySelectNew").value.trim();
    }
    if (!category) {
      this.notify("Please choose or enter a category", "error");
      return;
    }

    if (this._bulkCategoryMode) {
      const n = this.selectedCards.size;
      this.flashcards.forEach((c) => {
        if (this.selectedCards.has(c.id)) c.category = category;
      });
      this.selectedCards.clear();
      this._bulkCategoryMode = false;
      // restore modal title
      const title = document.querySelector("#categoryModal .modal-title");
      if (title) title.textContent = "Edit Category";
      this.saveData();
      this.updateUI();
      this.closeModal("categoryModal");
      this.notify(`Updated category for ${n} card(s)`);
      return;
    }

    const id = document.getElementById("categoryCardId").value;
    const card = this.flashcards.find((c) => c.id === id);
    if (!card) return;
    card.category = category;
    this.saveData();
    this.updateUI();
    this.closeModal("categoryModal");
    this.notify("Category updated!");
  },

  deleteCard(id) {
    if (!confirm("Delete this flashcard?")) return;
    this.flashcards = this.flashcards.filter((c) => c.id !== id);
    this.selectedCards.delete(id);
    this.saveData();
    this.updateUI();
    this.notify("Card deleted");
  },

  toggleCardSelection(id, checked) {
    if (checked) this.selectedCards.add(id);
    else this.selectedCards.delete(id);
    const item = document
      .querySelector(
        `.flashcard-item .card-select-cb[data-id="${CSS.escape(id)}"]`,
      )
      ?.closest(".flashcard-item");
    if (item) item.classList.toggle("selected", checked);
    this._syncSelectAllCheckbox();
    this.updateBulkBar();
  },

  _filteredCards() {
    const search =
      document.getElementById("searchCards")?.value.toLowerCase() || "";
    const activeCategory =
      document.querySelector(".category-tag.active")?.dataset.category || "all";
    return this.flashcards.filter((c) => {
      const matchSearch =
        c.term.toLowerCase().includes(search) ||
        c.definition.toLowerCase().includes(search);
      const matchCategory =
        activeCategory === "all" || c.category === activeCategory;
      return matchSearch && matchCategory;
    });
  },

  _syncSelectAllCheckbox(filtered) {
    const cb = document.getElementById("selectAllCards");
    if (!cb) return;
    if (!this.selectionMode) {
      cb.checked = false;
      cb.indeterminate = false;
      return;
    }
    const list = filtered || this._filteredCards();
    if (list.length === 0) {
      cb.checked = false;
      cb.indeterminate = false;
      return;
    }
    const selectedInView = list.filter((c) => this.selectedCards.has(c.id));
    cb.checked = selectedInView.length === list.length;
    cb.indeterminate =
      selectedInView.length > 0 && selectedInView.length < list.length;
  },

  toggleSelectAll(checked) {
    const list = this._filteredCards();
    if (checked) list.forEach((c) => this.selectedCards.add(c.id));
    else list.forEach((c) => this.selectedCards.delete(c.id));
    this.renderFlashcardList();
  },

  clearSelection() {
    this.selectedCards.clear();
    this.renderFlashcardList();
  },

  enterSelectionMode() {
    this.selectionMode = true;
    this.renderFlashcardList();
  },

  exitSelectionMode() {
    this.selectionMode = false;
    this.selectedCards.clear();
    this._bulkCategoryMode = false;
    this.closeModal("categoryModal");
    this.renderFlashcardList();
  },

  _syncSelectionUI() {
    const selectBtn = document.getElementById("selectModeBtn");
    const selectAllWrap = document.getElementById("selectAllWrap");
    if (selectBtn) selectBtn.style.display = this.selectionMode ? "none" : "";
    if (selectAllWrap)
      selectAllWrap.style.display = this.selectionMode ? "" : "none";
  },

  updateBulkBar() {
    const bar = document.getElementById("bulkActions");
    const count = document.getElementById("bulkCount");
    if (!bar) return;
    if (!this.selectionMode || this.selectedCards.size === 0) {
      bar.style.display = "none";
      return;
    }
    bar.style.display = "flex";
    if (count) count.textContent = `${this.selectedCards.size} selected`;
  },

  bulkDelete() {
    if (this.selectedCards.size === 0) return;
    const n = this.selectedCards.size;
    if (!confirm(`Delete ${n} selected flashcard(s)?`)) return;
    this.flashcards = this.flashcards.filter(
      (c) => !this.selectedCards.has(c.id),
    );
    this.selectedCards.clear();
    this.saveData();
    this.updateUI();
    this.notify(`Deleted ${n} card(s)`);
  },

  showBulkCategoryModal() {
    if (this.selectedCards.size === 0) return;
    this._bulkCategoryMode = true;
    const select = document.getElementById("categorySelect");
    const cats = [
      ...new Set(this.flashcards.map((c) => c.category).filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b));
    select.innerHTML =
      `<option value="">Select category...</option>` +
      cats
        .map(
          (c) =>
            `<option value="${this.escAttr(c)}">${this.escapeHtml(c)}</option>`,
        )
        .join("") +
      `<option value="__new__"> + Add new category</option>`;
    select.value = "";
    const newInput = document.getElementById("categorySelectNew");
    newInput.style.display = "none";
    newInput.value = "";
    const title = document.querySelector("#categoryModal .modal-title");
    if (title)
      title.textContent = `Change Category (${this.selectedCards.size} selected)`;
    document.getElementById("categoryModal").classList.add("active");
    select.focus();
  },

  bulkChangeCategory() {
    this.showBulkCategoryModal();
  },

  getCategories() {
    return [
      ...new Set(this.flashcards.map((c) => c.category).filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b));
  },

  renderPrefsCategories() {
    const container = document.getElementById("prefsCategoryList");
    if (!container) return;
    const cats = this.getCategories();
    if (cats.length === 0) {
      container.innerHTML =
        '<p style="color: var(--text-secondary); font-size: 0.85rem; margin: 0;">No categories yet. Add one when creating a card.</p>';
      return;
    }
    container.innerHTML = cats
      .map((cat) => {
        const count = this.flashcards.filter((c) => c.category === cat).length;
        return `
        <div class="prefs-category-row">
          <span class="prefs-category-name">${this.escapeHtml(cat)}</span>
          <span class="prefs-category-count">${count} card${count === 1 ? "" : "s"}</span>
          <button class="prefs-cat-btn" title="Rename" onclick="app.renameCategory(${this.jsArg(cat)})">
            <i class="material-icons">edit</i>
          </button>
          <button class="prefs-cat-btn prefs-cat-btn-danger" title="Delete" onclick="app.deleteCategory(${this.jsArg(cat)})">
            <i class="material-icons">delete</i>
          </button>
        </div>
      `;
      })
      .join("");
  },

  renameCategory(oldName) {
    const newName = prompt("Rename category:", oldName);
    if (newName === null) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    const exists = this.getCategories().includes(trimmed);
    let count = 0;
    this.flashcards.forEach((c) => {
      if (c.category === oldName) {
        c.category = trimmed;
        count++;
      }
    });
    this.saveData();
    this.updateUI();
    this.renderPrefsCategories();
    if (exists)
      this.notify(
        `Merged "${oldName}" into "${trimmed}" (${count} card${count === 1 ? "" : "s"})`,
      );
    else
      this.notify(
        `Renamed to "${trimmed}" (${count} card${count === 1 ? "" : "s"})`,
      );
  },

  deleteCategory(name) {
    const count = this.flashcards.filter((c) => c.category === name).length;
    if (count === 0) return;
    if (
      !confirm(
        `Delete category "${name}" and move its ${count} card(s) to Uncategorized?`,
      )
    )
      return;
    this.flashcards.forEach((c) => {
      if (c.category === name) c.category = "";
    });
    this.saveData();
    this.updateUI();
    this.renderPrefsCategories();
    this.notify(
      `Removed "${name}"; ${count} card${count === 1 ? "" : "s"} moved to Uncategorized`,
    );
  },

  renderFlashcardList() {
    const container = document.getElementById("flashcardList");
    const search =
      document.getElementById("searchCards")?.value.toLowerCase() || "";
    const activeCategory =
      document.querySelector(".category-tag.active")?.dataset.category || "all";

    let filtered = this.flashcards.filter((c) => {
      const matchSearch =
        c.term.toLowerCase().includes(search) ||
        c.definition.toLowerCase().includes(search);
      const matchCategory =
        activeCategory === "all" || c.category === activeCategory;
      return matchSearch && matchCategory;
    });

    if (filtered.length === 0) {
      container.innerHTML = `
                        <div class="empty-state">
                            <div class="empty-state-icon">
                            <img class="sad-icon" src="assets/images/sad.png" alt="" />
                            </div>
                            <h3>No flashcards found</h3>
                            <p>${this.flashcards.length === 0 ? "Create your first flashcard!" : "Try different search or category"}</p>
                            ${this.flashcards.length === 0 ? '<button class="btn btn-primary" style="margin-top: 16px;" onclick="app.showAddCardModal()">+ Create Flashcard</button>' : ""}
                        </div>`;
      this._syncSelectAllCheckbox(filtered);
      this.updateBulkBar();
      this._syncSelectionUI();
      return;
    }

    container.innerHTML = filtered
      .map(
        (c) => `
                    <div class="flashcard-item ${this.selectionMode && this.selectedCards.has(c.id) ? "selected" : ""}">
                        ${this.selectionMode ? `<input type="checkbox" class="card-select-cb" data-id="${this.escAttr(c.id)}" ${this.selectedCards.has(c.id) ? "checked" : ""} onchange="app.toggleCardSelection(${this.jsArg(c.id)}, this.checked)" />` : ""}
                        <div class="flashcard-item-content">
                            <div class="flashcard-item-term">${this.escapeHtml(c.term)}</div>
                            <div class="flashcard-item-definition">${this.escapeHtml(c.definition.substring(0, 100))}${c.definition.length > 100 ? "..." : ""}</div>
                            <div class="flashcard-item-tags">
                                ${c.category ? `<span class="tag">${this.escapeHtml(c.category)}</span>` : ""}
                                ${(c.tags || [])
                                  .slice(0, 3)
                                  .map(
                                    (t) =>
                                      `<span class="tag">${this.escapeHtml(t)}</span>`,
                                  )
                                  .join("")}
                                <span style="margin-left: auto; font-size: 0.75rem; color: var(--text-secondary);">
                                    ${["New", "Learning", "Review", "Mastered"][c.mastery || 0]}
                                </span>
                            </div>
                        </div>
                        <div class="flashcard-item-actions">
                            <button class="icon-btn" onclick="app.showCategoryModal(${this.jsArg(c.id)})" title="Edit category"><img class="edit-category-icon" src="assets/images/square-transfer-horizontal-bold.png"></button>
                            <button class="icon-btn" onclick="app.showAddCardModal(${this.jsArg(c.id)})" title="Edit"><img class="pen-icon" src="assets/images/pen-bold.png"></button>
                            <button class="icon-btn delete" onclick="app.deleteCard(${this.jsArg(c.id)})" title="Delete"><img class="trash-bin"src="assets/images/trash-bin-trash-bold.png"></button>
                        </div>
                    </div>
                `,
      )
      .join("");

    this._syncSelectAllCheckbox(filtered);
    this.updateBulkBar();
    this._syncSelectionUI();
  },

  updateCategoryFilters() {
    const categories = [
      ...new Set(this.flashcards.map((c) => c.category).filter(Boolean)),
    ];
    const container = document.getElementById("categoryFilters");
    container.innerHTML =
      `<span class="category-tag active" data-category="all" onclick="app.filterByCategory('all')">All</span>` +
      categories
        .map(
          (c) =>
            `<span class="category-tag" data-category="${this.escAttr(c)}" onclick="app.filterByCategory(${this.jsArg(c)})">${this.escapeHtml(c)}</span>`,
        )
        .join("");
  },

  filterCards() {
    this.renderFlashcardList();
  },

  filterByCategory(cat) {
    document.querySelectorAll(".category-tag").forEach((t) => {
      t.classList.toggle("active", t.dataset.category === cat);
    });
    this.renderFlashcardList();
  },

  exportCards() {
    const data = JSON.stringify(this.flashcards, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "flashcards.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.notify("Cards exported!");
  },

  importCards(data) {
    if (!Array.isArray(data)) {
      this.notify("Invalid format", "error");
      return;
    }

    const str = (v, max) =>
      typeof v === "string" || typeof v === "number"
        ? String(v).trim().slice(0, max)
        : "";
    const existing = new Set(
      this.flashcards.map((c) =>
        (c.term + "\u0000" + c.definition).toLowerCase(),
      ),
    );
    let imported = 0;
    let skipped = 0;
    data.slice(0, 5000).forEach((item) => {
      if (!item || typeof item !== "object") return;
      const term = str(item.term, 500);
      const definition = str(item.definition, 5000);
      if (!term || !definition) return;
      const key = (term + "\u0000" + definition).toLowerCase();
      if (existing.has(key)) {
        skipped++;
        return;
      }
      existing.add(key);
      {
        this.flashcards.push({
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          term,
          definition,
          category: str(item.category, 100),
          tags: Array.isArray(item.tags)
            ? item.tags
                .map((t) => str(t, 50))
                .filter(Boolean)
                .slice(0, 20)
            : [],
          mastery: 0,
          nextReview: Date.now(),
          interval: 1,
          ease: 2.5,
          reviews: 0,
          created: Date.now(),
        });
        imported++;
      }
    });

    this.saveData();
    this.updateUI();
    this.closeModal("importModal");
    this.notify(
      `Imported ${imported} cards!` +
        (skipped ? ` (${skipped} duplicates skipped)` : ""),
    );
  },

  importFromText() {
    const text = document.getElementById("importData").value.trim();
    if (!text) return;
    try {
      const data = JSON.parse(text);
      this.importCards(data);
    } catch (e) {
      this.notify("Invalid JSON format", "error");
    }
  },
});

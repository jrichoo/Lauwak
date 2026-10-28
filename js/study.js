Object.assign(app, {
  startStudy() {
    const now = Date.now();
    if (this._timerId) {
      clearTimeout(this._timerId);
      this._timerId = null;
    }
    const category = document.getElementById("studyCategory")?.value || "all";
    const shuffle = document.getElementById("studyShuffle")?.checked || false;

    let pool = this.flashcards.filter(
      (c) => category === "all" || c.category === category,
    );
    let due = pool.filter((c) => !c.nextReview || c.nextReview <= now);

    this.studyQueue = (due.length > 0 ? due : pool).slice();
    if (shuffle) this.studyQueue = this.shuffle(this.studyQueue);
    else this.studyQueue.sort((a, b) => (a.mastery || 0) - (b.mastery || 0));

    // Show an empty message without destroying the flashcard markup.
    const empty = document.getElementById("studyEmpty");
    if (this.studyQueue.length === 0) {
      document.getElementById("studyCardContainer").style.display = "none";
      document.getElementById("difficultyBtns").style.display = "none";
      document.getElementById("studyComplete").style.display = "none";
      if (empty) empty.style.display = "block";
      return;
    }
    if (empty) empty.style.display = "none";

    this.currentStudyIndex = 0;
    // Fix each card's direction for this session so going back keeps it.
    this.studyReversed = this.studyQueue.map(() => this.pickReversed());
    this.studySessionStart = Date.now();
    this.cardShownAt = Date.now();
    document.getElementById("studyComplete").style.display = "none";
    document.getElementById("studyCardContainer").style.display = "block";
    document.getElementById("difficultyBtns").style.display = "none";
    this.updateStudyTimer();
    this.showStudyCard();
  },

  updateStudyTimer() {
    if (!this.studySessionStart) return;
    const sec = Math.floor((Date.now() - this.studySessionStart) / 1000);
    const el = document.getElementById("studyTimer");
    if (el) {
      el.innerHTML = `<i class="material-icons">timer</i>${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    }
    this._timerId = setTimeout(() => this.updateStudyTimer(), 1000);
  },

  toggleFocusMode() {
    if (document.body.classList.contains("focus-mode")) {
      this.exitFocusMode();
    } else {
      this.enterFocusMode();
    }
  },

  enterFocusMode() {
    document.body.classList.add("focus-mode");
    document.body.style.paddingBottom = "0px";
    const btn = document.getElementById("studyFocusBtn");
    if (btn) btn.textContent = "⛶ Exit";
    if (
      document.documentElement.requestFullscreen &&
      !document.fullscreenElement
    ) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  },

  exitFocusMode() {
    document.body.classList.remove("focus-mode");
    document.body.style.paddingBottom = "";
    const btn = document.getElementById("studyFocusBtn");
    if (btn) btn.textContent = "⛶ Focus";
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  },

  showStudyCard() {
    if (this.currentStudyIndex >= this.studyQueue.length) {
      document.getElementById("studyCardContainer").style.display = "none";
      document.getElementById("difficultyBtns").style.display = "none";
      document.getElementById("studyComplete").style.display = "block";
      if (this._timerId) {
        clearTimeout(this._timerId);
        this._timerId = null;
      }
      this.studySessionStart = null;
      return;
    }

    const card = this.studyQueue[this.currentStudyIndex];
    // The completion screen hides the card; navigating back has to reveal it again.
    document.getElementById("studyCardContainer").style.display = "block";
    document.getElementById("studyComplete").style.display = "none";
    const rev = !!(
      this.studyReversed && this.studyReversed[this.currentStudyIndex]
    );
    document.getElementById("studyTerm").textContent = rev
      ? card.definition
      : card.term;
    document.getElementById("studyDefinition").textContent = rev
      ? card.term
      : card.definition;
    const fl = document.getElementById("studyFrontLabel");
    const bl = document.getElementById("studyBackLabel");
    if (fl) fl.textContent = rev ? "Definition" : "Term";
    if (bl) bl.textContent = rev ? "Term" : "Definition";
    document.getElementById("studyCounter").textContent =
      `${this.currentStudyIndex + 1} / ${this.studyQueue.length}`;
    document.getElementById("studyFlashcard").classList.remove("flipped");
    document.getElementById("difficultyBtns").style.display = "none";
    this.cardShownAt = Date.now();
  },

  flipCard() {
    const card = document.getElementById("studyFlashcard");
    card.classList.toggle("flipped");
    const btns = document.getElementById("difficultyBtns");
    if (card.classList.contains("flipped")) {
      if (btns) btns.style.display = "flex";
    } else {
      if (btns) btns.style.display = "none";
    }
  },

  prevStudyCard() {
    if (this.currentStudyIndex > 0) {
      this.currentStudyIndex--;
      this.showStudyCard();
    }
  },

  nextStudyCard() {
    if (this.currentStudyIndex < this.studyQueue.length - 1) {
      this.currentStudyIndex++;
      this.showStudyCard();
    }
  },

  rateCard(rating) {
    const card = this.studyQueue[this.currentStudyIndex];
    if (!card) return;

    const realCard = this.flashcards.find((c) => c.id === card.id);
    if (!realCard) return;

    const dt = Date.now() - (this.cardShownAt || Date.now());
    this.stats.responseTimes.push(dt);
    this.stats.studyTimeMs += dt;

    const today = new Date().toDateString();
    const last = this.stats.lastStudyDate;

    realCard.reviews = (realCard.reviews || 0) + 1;
    this.stats.totalReviews++;
    // Roll the counter over before counting this review: lastStudyDate is set to
    // today below, so updateDailyGoal() can no longer detect the day change.
    if (last !== today) this.stats.dailyReviewed = 0;
    this.stats.dailyReviewed = (this.stats.dailyReviewed || 0) + 1;

    if (rating >= 2) this.stats.correctAnswers++;

    // SM-2 Algorithm
    if (rating === 0) {
      realCard.mastery = 0;
      realCard.interval = 1;
    } else if (rating === 1) {
      realCard.interval = Math.max(1, realCard.interval * 1.2);
    } else {
      realCard.mastery = Math.min(3, (realCard.mastery || 0) + 1);
      if (rating === 3) {
        realCard.ease = Math.min(3, realCard.ease + 0.15);
        realCard.interval = realCard.interval * realCard.ease;
      } else {
        realCard.interval = realCard.interval * realCard.ease;
      }
    }

    realCard.nextReview = Date.now() + realCard.interval * 24 * 60 * 60 * 1000;

    if (last !== today) {
      const diff = last ? this.dayDiff(last, today) : 1;
      if (diff === 1) this.stats.streak = (this.stats.streak || 0) + 1;
      else if (diff > 1) this.stats.streak = 1;
      else if (!this.stats.streak) this.stats.streak = 1;
    } else if (!this.stats.streak) {
      this.stats.streak = 1;
    }
    this.stats.lastStudyDate = today;
    this.stats.studyHistory = this.stats.studyHistory || {};
    this.stats.studyHistory[today] = (this.stats.studyHistory[today] || 0) + 1;

    this.saveData();
    this.updateDailyGoal();
    this.currentStudyIndex++;
    this.showStudyCard();
  },
});

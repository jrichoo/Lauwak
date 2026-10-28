Object.assign(app, {
  switchQuizType(type, e) {
    this.quizType = type;
    this.clearQuizTimer();
    this.closeQuizSettings();
    document
      .querySelectorAll(".tab")
      .forEach((t) => t.classList.remove("active"));
    const target =
      (e && e.target) ||
      (typeof event !== "undefined" && event && event.target);
    if (target) target.classList.add("active");

    document.getElementById("quizSetup").style.display = "block";
    document.getElementById("quizActive").style.display = "none";
    document.getElementById("quizResults").style.display = "none";
  },

  toggleQuizSettings(e) {
    if (e) e.stopPropagation();
    const panel = document.getElementById("quizSettingsPanel");
    if (!panel) return;
    const open = panel.classList.toggle("open");
    const btn = document.getElementById("quizSettingsBtn");
    if (btn) btn.classList.toggle("active", open);
    if (open) {
      this._quizSettingsOutside = (ev) => {
        const p = document.getElementById("quizSettingsPanel");
        const b = document.getElementById("quizSettingsBtn");
        if (p && !p.contains(ev.target) && b && !b.contains(ev.target)) {
          this.closeQuizSettings();
        }
      };
      setTimeout(
        () => document.addEventListener("click", this._quizSettingsOutside),
        0,
      );
    } else {
      this.closeQuizSettings();
    }
  },

  closeQuizSettings() {
    const panel = document.getElementById("quizSettingsPanel");
    if (panel) panel.classList.remove("open");
    const btn = document.getElementById("quizSettingsBtn");
    if (btn) btn.classList.remove("active");
    if (this._quizSettingsOutside) {
      document.removeEventListener("click", this._quizSettingsOutside);
      this._quizSettingsOutside = null;
    }
  },

  startQuiz() {
    if (this.flashcards.length < 2) {
      this.notify("Need at least 2 cards for a quiz", "error");
      return;
    }

    const category = document.getElementById("quizCategory")?.value || "all";
    this.quizCategory = category;
    let pool = this.flashcards;
    if (category !== "all") {
      pool = pool.filter((c) => c.category === category);
    }

    if (pool.length < 2) {
      this.notify("Need at least 2 cards in this category", "error");
      return;
    }

    const count = Math.min(
      parseInt(document.getElementById("quizCount").value) || 10,
      pool.length,
    );

    this.quizTimerEnabled =
      document.getElementById("quizTimerEnabled")?.checked || false;
    this.quizTimePerQ =
      parseInt(document.getElementById("quizTimerSeconds")?.value) || 20;
    this.quizMixedMode =
      document.getElementById("quizMixedMode")?.checked || false;
    this.closeQuizSettings();
    this.clearQuizTimer();

    const effectiveType =
      this.quizMixedMode && this.quizType !== "match" ? "mixed" : this.quizType;
    const savedType = this.quizType;
    this.quizType = effectiveType;
    const shuffled = this.shuffle(pool).slice(0, count);

    this.currentQuiz = {
      questions: shuffled.map((card, idx) => this.generateQuestion(card, idx)),
      currentIndex: 0,
      score: 0,
      startTime: Date.now(),
    };
    this.quizType = savedType;

    this.quizStreak = 0;
    // Abandoned quizzes never reach showQuizResults(), which is the only other
    // place quizScore is cleared; match results read it directly.
    this.quizScore = 0;
    this.quizAnswered = false;
    document.getElementById("sectionHidden").style.display = "none";
    document.getElementById("quizSetup").style.display = "none";
    document.getElementById("quizSetup").style.display = "none";
    document.getElementById("quizActive").style.display = "block";
    document.getElementById("quizResults").style.display = "none";
    document.getElementById("tabNav").style.display = "none";
    document.getElementById("backHome").style.display = "flex";
    this.showQuizQuestion();
  },

  generateQuestion(card, index) {
    const others = this.flashcards
      .filter((c) => c.id !== card.id)
      .sort(() => Math.random() - 0.5);

    if (this.quizType === "mixed") {
      const mixedTypes = ["multiple", "truefalse", "typein"];
      const pick = mixedTypes[Math.floor(Math.random() * mixedTypes.length)];
      const saved = this.quizType;
      this.quizType = pick;
      const q = this.generateQuestion(card, index);
      this.quizType = saved;
      return q;
    }

    if (this.quizType === "multiple") {
      // Direction: rev = show the definition and ask for the term.
      const rev = this.pickReversed();
      const ask = (c) => (rev ? c.definition : c.term);
      const ans = (c) => (rev ? c.term : c.definition);
      const hint = rev
        ? "Which term matches this definition?"
        : "Which definition matches this term?";
      const correctAns = ans(card);
      const wrongOptions = [
        ...new Set(others.map(ans).filter((a) => a && a !== correctAns)),
      ].slice(0, 3);
      const options = this.shuffle([...wrongOptions, correctAns]);
      return {
        type: "multiple",
        question: ask(card),
        hint,
        options,
        correct: correctAns,
        cardId: card.id,
      };
    } else if (this.quizType === "truefalse") {
      const rev = this.pickReversed();
      const ans = (c) => (rev ? c.term : c.definition);
      const wrong = others.map(ans).find((a) => a && a !== ans(card));
      const isTrue = !wrong || Math.random() > 0.5;
      return {
        type: "truefalse",
        question: rev ? card.definition : card.term,
        hint: rev ? "Is this the right term?" : "Is this the right definition?",
        statement: isTrue ? ans(card) : wrong,
        correct: isTrue,
        correctAnswer: ans(card),
        cardId: card.id,
      };
    } else if (this.quizType === "typein") {
      const rev = this.pickReversed();
      return {
        type: "typein",
        question: rev ? card.definition : card.term,
        hint: rev ? "Type the term" : "Type the definition",
        correct: rev ? card.term : card.definition,
        cardId: card.id,
      };
    } else {
      const matchPool =
        this.quizCategory === "all"
          ? this.flashcards
          : this.flashcards.filter((c) => c.category === this.quizCategory);
      return {
        type: "match",
        pairs: matchPool
          .slice(0, Math.min(6, matchPool.length))
          .map((c) => ({ term: c.term, definition: c.definition, id: c.id })),
      };
    }
  },

  showQuizQuestion() {
    const quiz = this.currentQuiz;
    if (!quiz) return;

    if (this.quizType === "match") {
      this.showMatchQuiz(quiz);
      return;
    }
    const q = quiz.questions[quiz.currentIndex];
    const total = quiz.questions.length;
    const current = quiz.currentIndex + 1;

    document.getElementById("quizQuestionNum").textContent =
      `Question ${current}/${total}`;

    document.getElementById("quizProgressBar").style.width =
      `${(current / total) * 100}%`;

    const streakEl = document.getElementById("quizStreak");

    if (this.quizStreak >= 15) {
      streakEl.style.display = "inline-flex";
      // Use innerHTML and properly format the HTML string with the streak number
      streakEl.innerHTML = `<img class="streak-icon" src="assets/images/fire-blue.png" alt="Fire"> ${this.quizStreak}`;
    } else if (this.quizStreak >= 4) {
      streakEl.style.display = "inline-flex";
      streakEl.innerHTML = `<img class="streak-icon" src="assets/images/fire-red.png" alt="Fire"> ${this.quizStreak}`;
    } else {
      streakEl.style.display = "none";
    }
    document.getElementById("quizQuestion").textContent = q.question;
    document.getElementById("quizFeedback").style.display = "none";
    document.getElementById("quizNextBtn").style.display = "none";
    this.quizAnswered = false;

    const content = document.getElementById("quizContent");
    const hintHtml = q.hint
      ? `<p class="quiz-direction-hint">${this.escapeHtml(q.hint)}</p>`
      : "";

    if (q.type === "multiple") {
      content.innerHTML =
        hintHtml +
        `<div class="quiz-options">
                        ${q.options
                          .map(
                            (opt, i) => `
                            <button class="quiz-option" onclick="app.answerQuiz(${this.jsArg(opt)})">${this.escapeHtml(opt)}</button>
                        `,
                          )
                          .join("")}
                    </div>`;
    } else if (q.type === "truefalse") {
      content.innerHTML =
        hintHtml +
        `
                        <p style="margin-bottom: 16px; font-size: 1.1rem;">${this.escapeHtml(q.statement)}</p>
                        <div class="quiz-options">
                            <button class="quiz-option" onclick="app.answerQuiz(true)">True</button>
                            <button class="quiz-option" onclick="app.answerQuiz(false)">False</button>
                        </div>`;
    } else if (q.type === "typein") {
      content.innerHTML =
        hintHtml +
        `
                        <input type="text" class="form-input" id="typeAnswer" placeholder="Type your answer..." onkeypress="if(event.key==='Enter')app.answerTypeQuiz()">
                        <button class="btn btn-primary" style="margin-top: 12px;" onclick="app.answerTypeQuiz()">Submit</button>`;
    }

    this.startQuestionTimer();
  },

  showMatchQuiz(quiz) {
    const pairs = quiz.questions[0].pairs;
    // showQuizQuestion() returns here before its own reset, so clear these here.
    document.getElementById("quizNextBtn").style.display = "none";
    document.getElementById("quizFeedback").style.display = "none";
    document.getElementById("quizQuestion").textContent =
      "Match the terms with definitions";
    document.getElementById("quizContent").innerHTML = `
                    <div class="match-grid">
                        <div class="match-column" id="matchTerms">
                            ${this.shuffle(pairs)
                              .map(
                                (p) => `
                                <div class="match-item" data-id="${p.id}" data-type="term" onclick="app.selectMatch(this)">${this.escapeHtml(p.term)}</div>
                            `,
                              )
                              .join("")}
                        </div>
                        <div class="match-column" id="matchDefs">
                            ${this.shuffle(pairs)
                              .map(
                                (p) => `
                                <div class="match-item" data-id="${p.id}" data-type="def" onclick="app.selectMatch(this)">${this.escapeHtml(p.definition)}</div>
                            `,
                              )
                              .join("")}
                        </div>
                    </div>`;

    this.matchSelected = null;
    this.matchPairs = pairs;
    this.matchedCount = 0;
  },

  selectMatch(el) {
    if (el.classList.contains("matched")) return;

    if (!this.matchSelected) {
      this.matchSelected = el;
      el.classList.add("selected");
    } else {
      if (this.matchSelected.dataset.type === el.dataset.type) {
        this.matchSelected.classList.remove("selected");
        this.matchSelected = el;
        el.classList.add("selected");
      } else {
        if (this.matchSelected.dataset.id === el.dataset.id) {
          this.matchSelected.classList.remove("selected");
          this.matchSelected.classList.add("matched");
          el.classList.add("matched");
          this.matchedCount++;
          this.quizScore++;
          this.quizStreak++;

          if (this.matchedCount === this.matchPairs.length) {
            setTimeout(() => {
              this.currentQuiz = null;
              this.showQuizResults();
            }, 500);
          }
        } else {
          const prev = this.matchSelected;
          this.matchSelected = null;
          prev.classList.add("wrong");
          el.classList.add("wrong");
          this.quizStreak = 0;
          setTimeout(() => {
            prev.classList.remove("selected", "wrong");
            el.classList.remove("wrong");
          }, 500);
          return;
        }
        this.matchSelected = null;
      }
    }
  },

  answerQuiz(answer) {
    if (this.quizAnswered) return;
    this.quizAnswered = true;
    this.clearQuizTimer();

    const q = this.currentQuiz.questions[this.currentQuiz.currentIndex];
    const isCorrect =
      q.type === "multiple" ? answer === q.correct : answer === q.correct;

    if (isCorrect) {
      this.currentQuiz.score++;
      this.quizStreak++;
    } else {
      this.quizStreak = 0;
    }

    const options = document.querySelectorAll(".quiz-option");
    options.forEach((opt) => {
      opt.classList.add("disabled");
      const optText =
        q.type === "multiple" ? opt.textContent : opt.textContent === "True";
      if (optText === q.correct || optText === q.correctAnswer) {
        opt.classList.add("correct");
      }
      if (optText === answer && !isCorrect) {
        opt.classList.add("wrong");
      }
    });

    const correctText =
      q.type === "truefalse" ? (q.correct ? "True" : "False") : q.correct;
    const feedback = document.getElementById("quizFeedback");
    feedback.style.display = "block";
    feedback.style.background = isCorrect
      ? "var(--success-light)"
      : "var(--danger-light)";
    feedback.style.color = isCorrect ? "var(--success)" : "var(--danger)";
    feedback.innerHTML = isCorrect
      ? " Correct!"
      : '<span class="feedback-label">× INCORRECT</span><span class="feedback-answer"><strong>Correct answer:</strong> ' +
        this.escapeHtml(correctText) +
        "</span>";

    document.getElementById("quizNextBtn").style.display = "inline-flex";
  },

  answerTypeQuiz() {
    if (this.quizAnswered) return;
    this.quizAnswered = true;
    this.clearQuizTimer();

    const q = this.currentQuiz.questions[this.currentQuiz.currentIndex];
    const answer = document.getElementById("typeAnswer").value;
    const isCorrect =
      this.normAnswer(answer) !== "" &&
      this.normAnswer(answer) === this.normAnswer(q.correct);

    if (isCorrect) {
      this.currentQuiz.score++;
      this.quizStreak++;
    } else {
      this.quizStreak = 0;
    }

    const feedback = document.getElementById("quizFeedback");
    feedback.style.display = "block";
    feedback.style.background = isCorrect
      ? "var(--success-light)"
      : "var(--danger-light)";
    feedback.style.color = isCorrect ? "var(--success)" : "var(--danger)";
    feedback.innerHTML = isCorrect
      ? "Correct!"
      : '<span class="feedback-label">× INCORRECT</span><span class="feedback-answer"><strong>Correct answer:</strong> ' +
        this.escapeHtml(q.correct) +
        "</span>";

    document.getElementById("quizNextBtn").style.display = "inline-flex";
  },

  nextQuizQuestion() {
    this.currentQuiz.currentIndex++;
    if (this.currentQuiz.currentIndex >= this.currentQuiz.questions.length) {
      this.showQuizResults();
    } else {
      this.showQuizQuestion();
    }
  },

  clearQuizTimer() {
    if (this._quizTimer) {
      clearInterval(this._quizTimer);
      this._quizTimer = null;
    }
    const el = document.getElementById("quizTimer");
    if (el) el.style.display = "none";
  },

  startQuestionTimer() {
    this.clearQuizTimer();
    const el = document.getElementById("quizTimer");
    if (!el || !this.quizTimerEnabled || this.quizType === "match") return;
    this._quizTimeLeft = this.quizTimePerQ || 20;
    el.style.display = "inline-flex";
    el.classList.remove("warning");
    el.textContent = "⏱ " + this._quizTimeLeft;
    this._quizTimer = setInterval(() => {
      this._quizTimeLeft--;
      if (this._quizTimeLeft <= 5) el.classList.add("warning");
      el.textContent = "⏱ " + Math.max(this._quizTimeLeft, 0);
      if (this._quizTimeLeft <= 0) {
        this.clearQuizTimer();
        this.handleQuizTimeout();
      }
    }, 1000);
  },

  handleQuizTimeout() {
    if (this.quizAnswered) return;
    const q = this.currentQuiz.questions[this.currentQuiz.currentIndex];
    if (q.type === "typein") {
      this.quizAnswered = true;
      this.quizStreak = 0;
      const input = document.getElementById("typeAnswer");
      if (input) input.disabled = true;
      const feedback = document.getElementById("quizFeedback");
      feedback.style.display = "block";
      feedback.style.background = "var(--danger-light)";
      feedback.style.color = "var(--danger)";
      feedback.innerHTML =
        '<span class="feedback-label">× INCORRECT</span><span class="feedback-answer"><strong>Correct answer:</strong> ' +
        this.escapeHtml(q.correct) +
        "</span>";
      document.getElementById("quizNextBtn").style.display = "inline-flex";
    } else {
      this.answerQuiz(null);
    }
  },

  showQuizResults() {
    this.clearQuizTimer();
    const quiz = this.currentQuiz;
    const total =
      this.quizType === "match"
        ? this.matchPairs.length
        : quiz.questions.length;
    const score = this.quizType === "match" ? this.quizScore : quiz.score;
    const pct = Math.round((score / total) * 100);

    document.getElementById("quizActive").style.display = "none";
    document.getElementById("quizResults").style.display = "block";
    document.getElementById("quizScorePercent").textContent = `${pct}%`;
    document.getElementById("quizScoreCorrect").textContent = score;
    document.getElementById("quizScoreTotal").textContent = total;

    let text = "Keep practicing!";
    if (pct >= 90) text = `Outstanding!`;
    else if (pct >= 70) text = "Great job!";
    else if (pct >= 50) text = "Good effort!";
    document.getElementById("quizScoreText").textContent = text;

    this.stats.totalReviews += total;
    this.stats.correctAnswers += score;
    const today = new Date().toDateString();
    const last = this.stats.lastStudyDate;
    if (last !== today) {
      const diff = last ? this.dayDiff(last, today) : 1;
      if (diff === 1) this.stats.streak = (this.stats.streak || 0) + 1;
      else if (diff > 1) this.stats.streak = 1;
      else if (!this.stats.streak) this.stats.streak = 1;
    } else if (!this.stats.streak) {
      this.stats.streak = 1;
    }
    this.stats.studyHistory[today] =
      (this.stats.studyHistory[today] || 0) + total;
    this.stats.lastStudyDate = today;
    this.saveData();
    this.currentQuiz = null;
    this.quizScore = 0;
  },
});

Object.assign(app, {
  switchCodeTab(tab, e) {
    document
      .querySelectorAll(".tab")
      .forEach((t) => t.classList.remove("active"));
    const btn = (e || event).currentTarget;
    if (btn) btn.classList.add("active");
    document.getElementById("codeManage").style.display =
      tab === "manage" ? "block" : "none";
    document.getElementById("codePractice").style.display =
      tab === "practice" ? "block" : "none";
    if (tab === "manage") this.renderCodeList();
    else {
      this.populateCodePracticeLangs();
      this.startPractice();
    }
  },

  populateCodePracticeLangs() {
    const select = document.getElementById("codePracticeLang");
    if (!select) return;
    const langs = [
      ...new Set(this.codeItems.map((c) => c.lang || "JavaScript")),
    ].sort();
    const current = select.value || "all";
    select.innerHTML =
      `<option value="all">All languages</option>` +
      langs
        .map(
          (l) =>
            `<option value="${this.escAttr(l)}">${this.escapeHtml(l)}</option>`,
        )
        .join("");
    select.value =
      current === "all" || langs.includes(current) ? current : "all";
  },

  renderCodeList() {
    const container = document.getElementById("codeList");
    if (!container) return;
    if (this.codeItems.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">
          <img class="lauwak-icon" src="assets/images/disappoint.png"
          </div>
          <h3>No questions yet</h3>
          <p>Add your first programming question above!</p>
        </div>`;
      return;
    }
    container.innerHTML = this.codeItems
      .map(
        (it) => `
        <div class="code-item">
          <div class="code-item-header">
            <div class="code-item-question">${this.escapeHtml(it.question)}</div>
            <div class="code-item-actions">
               <button class="icon-btn" onclick="app.editCodeItem(${this.jsArg(it.id)})" title="Edit"><img class="pen-icon" src="assets/images/pen-bold.png"></button>
               <button class="icon-btn delete" onclick="app.deleteCodeItem(${this.jsArg(it.id)})" title="Delete">
              <img class="trash-bin" src="assets/images/trash-bin-trash-bold.png"></button>
            </div>
          </div>
          <div class="code-item-meta">
            <span class="code-item-lang">${this.escapeHtml(it.lang || "JavaScript")}</span>
            <span class="tag" style="background:var(--warning-light); color:var(--warning)">${this.codeMasteryLabel(it)}</span>
            <span style="font-size: 0.78rem; color: var(--text-secondary)">Practiced: ${it.reviews || 0} · Correct: ${it.correct || 0}</span>
          </div>
          <pre class="code-answer-snippet">${this.escapeHtml(it.answer)}</pre>
        </div>`,
      )
      .join("");
  },

  saveCodeItem() {
    const question = document.getElementById("codeQuestion").value.trim();
    const answer = document.getElementById("codeAnswer").value.trim();
    const lang = document.getElementById("codeLang").value;
    const editId = document.getElementById("codeEditId").value;
    {
    }

    if (!question || !answer) {
      this.notify("Please fill in both question and answer", "error");
      return;
    }
    if (editId) {
      const it = this.codeItems.find((c) => c.id === editId);
      if (it) {
        it.question = question;
        it.answer = answer;
        it.lang = lang;
      }
    } else {
      this.codeItems.push({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        question,
        answer,
        lang,
        reviews: 0,
        correct: 0,
        mastery: 0,
        interval: 1,
        ease: 2.5,
        nextReview: Date.now(),
      });
    }
    this.saveData();
    this.renderCodeList();
    this.resetCodeForm();
    this.notify(editId ? "Question updated!" : "Question added!");
  },

  editCodeItem(id) {
    const it = this.codeItems.find((c) => c.id === id);
    if (!it) return;
    document.getElementById("codeEditId").value = it.id;
    document.getElementById("codeFormTitle").textContent = "Edit Question";
    document.getElementById("codeQuestion").value = it.question;
    document.getElementById("codeAnswer").value = it.answer;
    document.getElementById("codeLang").value = it.lang || "JavaScript";
    document
      .getElementById("codeManage")
      .scrollIntoView({ behavior: "smooth" });
  },

  deleteCodeItem(id) {
    if (!confirm("Delete this question?")) return;
    this.codeItems = this.codeItems.filter((c) => c.id !== id);
    this.saveData();
    this.renderCodeList();
    this.notify("Question deleted");
  },

  resetCodeForm() {
    document.getElementById("codeEditId").value = "";
    document.getElementById("codeFormTitle").textContent = "Add Question";
    document.getElementById("codeQuestion").value = "";
    document.getElementById("codeAnswer").value = "";
    document.getElementById("codeLang").value = "JavaScript";
  },

  exportCodeItems() {
    if (this.codeItems.length === 0) {
      this.notify("Nothing to export yet", "error");
      return;
    }
    const data = JSON.stringify(this.codeItems, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "code-practice.json";
    a.click();
    URL.revokeObjectURL(url);
    this.notify("Exported!");
  },

  importCodeItems(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!Array.isArray(data)) throw new Error("Invalid");
        const ids = new Set(this.codeItems.map((c) => c.id));
        let added = 0;
        data.forEach((item) => {
          if (item && item.question && item.answer) {
            const id =
              item.id && !ids.has(item.id)
                ? item.id
                : Date.now().toString() +
                  Math.random().toString(36).substr(2, 9);
            ids.add(id);
            this.codeItems.push({
              lang: "JavaScript",
              reviews: 0,
              correct: 0,
              mastery: 0,
              interval: 1,
              ease: 2.5,
              nextReview: Date.now(),
              ...item,
              id,
            });
            added++;
          }
        });
        this.saveData();
        this.renderCodeList();
        this.notify(`Imported ${added} question(s)!`);
      } catch (err) {
        this.notify("Invalid JSON file", "error");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  },

  startPractice() {
    const filter = document.getElementById("codePracticeLang")?.value || "all";
    this.codePracticePool =
      filter === "all"
        ? this.codeItems.slice()
        : this.codeItems.filter((c) => (c.lang || "JavaScript") === filter);
    const now = Date.now();
    this.codePracticePool.sort((a, b) => {
      const aDue = (a.nextReview || 0) <= now ? 0 : 1;
      const bDue = (b.nextReview || 0) <= now ? 0 : 1;
      if (aDue !== bDue) return aDue - bDue;
      return (a.mastery || 0) - (b.mastery || 0);
    });
    if (this.codePracticePool.length === 0) {
      document.getElementById("codePracticeCard").innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">
          <img class="lauwak-icon" src="assets/images/disappoint.png"></div>
          <h3>No questions to practice</h3>
          <p>${
            this.codeItems.length === 0
              ? 'Add some questions in the "My Questions" tab first!'
              : "No questions for this language yet."
          }</p>
          <button class="btn btn-primary" style="margin-top:16px" onclick="app.switchCodeTab('manage', event); setTimeout(function(){ var el=document.getElementById('codeQuestion'); if(el) el.focus(); }, 60)">+ Add Question</button>
        </div>`;
      return;
    }
    this.codePracticeIndex = 0;
    this.codeRevealed = false;
    this.renderCodePractice();
  },

  renderCodePractice() {
    const card = document.getElementById("codePracticeCard");
    if (!card) return;
    const it = this.codePracticePool[this.codePracticeIndex];
    if (!it) return;
    const total = this.codePracticePool.length;
    const current = this.codePracticeIndex + 1;
    const lang = it.lang || "JavaScript";
    const canRun = ["JavaScript", "Python", "C++", "Java"].includes(lang);
    const fileExt =
      { JavaScript: "js", Python: "py", "C++": "cpp", Java: "java" }[lang] ||
      "txt";
    const editorPlaceholder =
      lang === "Java"
        ? "public class Main {\n    public static void main(String[] args) {\n        // your code here\n    }\n}"
        : lang === "C++"
          ? "#include <iostream>\nusing namespace std;\n\nint main() {\n    // your code here\n    return 0;\n}"
          : "Write your code here...";
    card.innerHTML = `
      <div class="code-practice-top">
        <div class="quiz-header">
          <span>Question ${current}/${total}</span>
          <span class="tag">${this.escapeHtml(lang)}</span>
          <span class="tag" style="background:var(--warning-light); color:var(--warning)">${this.codeMasteryLabel(it)}</span>
        </div>
        <div class="quiz-progress"><div class="quiz-progress-bar" style="width:${(current / total) * 100}%"></div></div>
        <div class="practice-question">${this.escapeHtml(it.question)}</div>
      </div>

      ${
        !this.codeRevealed
          ? `
        <div class="code-editor">
          <div class="code-editor-toolbar">
            <div class="code-editor-dots">
              <span class="editor-dot red"></span>
              <span class="editor-dot yellow"></span>
              <span class="editor-dot green"></span>
            </div>
            <span class="code-editor-filename">user-answer.${fileExt}</span>
            <div class="code-editor-actions">
              ${
                canRun
                  ? `<button class="btn-run" onclick="app.runUserCode()">▶ Run</button>`
                  : `<span class="btn-run btn-run-disabled" title="Run is available for JavaScript, Python, C++ & Java">▶ Run</span>`
              }
            </div>
          </div>
          <div class="code-editor-body">
            <div class="code-gutter" id="codeGutter">1</div>
            <div class="code-input-wrap">
              <pre class="code-highlight" id="codeHighlight"></pre>
              <textarea class="code-user-textarea" id="codeUserAnswer" placeholder="${this.escapeHtml(editorPlaceholder)}" spellcheck="false"></textarea>
            </div>
          </div>
        </div>

        <pre class="code-console" id="codeConsole" style="display:none;"></pre>

        <div class="code-practice-actions">
          <button class="btn btn-secondary" onclick="app.revealCodeAnswer()">Reveal Answer</button>
        </div>
      `
          : `
        <div class="code-compare">
          <div>
            <h3>Your Answer</h3>
            <pre class="debug-code code-user">${this.highlightCode(this._lastUserAnswer || "", lang)}</pre>
          </div>
          <div>
            <h3>Model Answer</h3>
            <pre class="debug-code">${this.highlightCode(it.answer, lang)}</pre>
          </div>
        </div>
        <div class="code-practice-actions">
          <button class="btn btn-success" onclick="app.rateCodeItem(true)"> I got it right</button>
          <button class="btn btn-danger" onclick="app.rateCodeItem(false)"> I missed it</button>
        </div>
      `
      }

      <div class="code-practice-footer">
        <button class="btn btn-secondary btn-small" onclick="app.nextCodeItem()">Next Question ▶</button>
      </div>
    `;
    this.setupCodeEditor();
  },

  setupCodeEditor() {
    const ta = document.getElementById("codeUserAnswer");
    const gutter = document.getElementById("codeGutter");
    const highlight = document.getElementById("codeHighlight");
    if (!ta) return;
    const it = this.codePracticePool[this.codePracticeIndex];
    const lang = it ? it.lang || "JavaScript" : "JavaScript";
    const syncScroll = () => {
      if (highlight) {
        highlight.scrollTop = ta.scrollTop;
        highlight.scrollLeft = ta.scrollLeft;
      }
      if (gutter) gutter.scrollTop = ta.scrollTop;
    };
    const paint = () => {
      if (!highlight) return;
      highlight.innerHTML = this.highlightCode(ta.value, lang);
      highlight.scrollTop = ta.scrollTop;
      highlight.scrollLeft = ta.scrollLeft;
    };
    const updateGutter = () => {
      if (!gutter) return;
      const lines = ta.value.split("\n").length || 1;
      let html = "";
      for (let i = 1; i <= lines; i++) {
        html += i + (i < lines ? "<br>" : "");
      }
      gutter.innerHTML = html;
      gutter.scrollTop = ta.scrollTop;
    };
    ta.addEventListener("scroll", syncScroll);
    ta.addEventListener("input", () => {
      updateGutter();
      paint();
    });
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const s = ta.selectionStart;
        const en = ta.selectionEnd;
        ta.value = ta.value.slice(0, s) + "  " + ta.value.slice(en);
        ta.selectionStart = ta.selectionEnd = s + 2;
        updateGutter();
        paint();
      }
    });
    updateGutter();
    paint();
  },

  formatValue(v) {
    if (typeof v === "string") return v;
    if (v === undefined) return "undefined";
    if (v === null) return "null";
    if (typeof v === "function") return v.toString();
    if (v && typeof v.toJs === "function") {
      try {
        return JSON.stringify(v.toJs());
      } catch (e) {}
    }
    try {
      return JSON.stringify(v);
    } catch (e) {
      return String(v);
    }
  },

  codeMasteryLabel(item) {
    const m = item.mastery || 0;
    return ["New", "Learning", "Review", "Mastered"][
      Math.max(0, Math.min(3, m))
    ];
  },

  highlightCode(code, lang) {
    try {
      const language =
        lang === "JavaScript"
          ? "javascript"
          : lang === "Python"
            ? "python"
            : lang === "C++"
              ? "cpp"
              : lang === "Java"
                ? "java"
                : "clike";
      return Prism.highlight(
        code,
        Prism.languages[language] || Prism.languages.clike,
        language,
      );
    } catch (e) {
      return this.escapeHtml(code);
    }
  },

  runUserCode() {
    const ta = document.getElementById("codeUserAnswer");
    const out = document.getElementById("codeConsole");
    if (!ta || !out) return;
    const it = this.codePracticePool[this.codePracticeIndex];
    const lang = (it && it.lang) || "JavaScript";
    const code = ta.value;
    if (lang === "Python") {
      this.runPythonCode(code, out);
      return;
    }
    if (lang === "C++" || lang === "Java") {
      this.runCompiledCode(lang, code, out);
      return;
    }
    const logs = [];
    const push = (...args) =>
      logs.push(args.map((a) => this.formatValue(a)).join(" "));
    const sandboxConsole = {
      log: push,
      info: push,
      warn: (...a) =>
        logs.push("[warn] " + a.map((x) => this.formatValue(x)).join(" ")),
      error: (...a) =>
        logs.push("[error] " + a.map((x) => this.formatValue(x)).join(" ")),
    };
    try {
      const fn = new Function("console", code);
      const result = fn(sandboxConsole);
      if (result !== undefined) logs.push("⇒ " + this.formatValue(result));
    } catch (err) {
      const msg =
        err && err.stack
          ? err.stack.split("\n").slice(0, 3).join("\n")
          : String(err);
      logs.push("[error] " + msg);
    }
    out.textContent = logs.length
      ? logs.join("\n")
      : "(no output — use console.log(...) or end with a return value)";
    out.style.display = "block";
  },

  ensurePyodide() {
    if (this._pyodide) return Promise.resolve(this._pyodide);
    if (!this._pyodideLoading) {
      this._pyodideLoading = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js";
        script.onload = async () => {
          try {
            const py = await loadPyodide();
            this._pyodide = py;
            resolve(py);
          } catch (e) {
            this._pyodideLoading = null;
            reject(e);
          }
        };
        script.onerror = () => {
          this._pyodideLoading = null;
          reject(
            new Error("Could not load Python runtime (internet required)"),
          );
        };
        document.head.appendChild(script);
      });
    }
    return this._pyodideLoading;
  },

  async runPythonCode(code, out) {
    out.style.display = "block";
    out.textContent = "Loading Python runtime…";
    let py;
    try {
      py = await this.ensurePyodide();
    } catch (e) {
      out.textContent = "[error] " + e.message;
      return;
    }
    const logs = [];
    py.setStdout({ batched: (s) => logs.push(s) });
    py.setStderr({ batched: (s) => logs.push("[error] " + s) });
    try {
      const result = await py.runPythonAsync(code);
      if (result !== undefined && result !== null) {
        logs.push("⇒ " + this.formatValue(result));
      }
    } catch (e) {
      logs.push("[error] " + String(e));
    }
    out.textContent = logs.length ? logs.join("\n") : "(no output)";
  },

  async runCompiledCode(lang, code, out) {
    out.style.display = "block";
    if (!code.trim()) {
      out.textContent = "(write some code first)";
      return;
    }
    out.textContent =
      lang === "Java"
        ? "Compiling with JDK 21..."
        : "Compiling with GCC 14.2...";
    let source = code;
    if (lang === "Java") {
      source = source.replace(
        /\bpublic\s+(?=(class|interface|enum|record)\b)/,
        "",
      );
    }
    try {
      const res = await fetch(
        `https://godbolt.org/api/compiler/${lang === "C++" ? "g142" : "java2102"}/compile`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            source,
            options: {
              userArguments: "",
              filters: { execute: true, binary: true },
              compilerOptions: { executorRequest: true },
            },
          }),
        },
      );
      if (!res.ok) throw new Error("compiler service HTTP " + res.status);
      const data = await res.json();
      const clean = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
      const read = (arr) =>
        clean(
          (arr || []).map((s) => s.text.replace(/\n+$/, "")).join("\n"),
        ).replace(/\n+$/, "");
      const lines = [];
      if (data.timedOut) lines.push("[error] Program timed out");
      if (data.didExecute) {
        const so = read(data.stdout);
        const se = read(data.stderr);
        if (so) lines.push(so);
        if (se) lines.push("[stderr] " + se);
        if (!so && !se) lines.push("(program finished with no output)");
      } else {
        const buildErr = read(data.buildResult && data.buildResult.stderr);
        const err = buildErr || read(data.stderr);
        lines.push(err || `[error] Compilation failed (code ${data.code})`);
      }
      lines.push(`- exit code: ${data.code}`);
      out.textContent = lines.join("\n");
    } catch (e) {
      out.textContent =
        "[error] Could not reach the online compiler (internet required)\n" +
        (e && e.message ? e.message : String(e));
    }
  },

  revealCodeAnswer() {
    const ta = document.getElementById("codeUserAnswer");
    this._lastUserAnswer = ta ? ta.value : "";
    this.codeRevealed = true;
    this.renderCodePractice();
  },

  scheduleCodeItem(item, correct) {
    const now = Date.now();
    item.reviews = (item.reviews || 0) + 1;
    if (correct) {
      item.correct = (item.correct || 0) + 1;
      item.mastery = Math.min(3, (item.mastery || 0) + 1);
      item.ease = Math.min(3, (item.ease || 2.5) + 0.1);
      item.interval = Math.max(1, Math.round((item.interval || 1) * item.ease));
      item.nextReview = now + item.interval * 24 * 60 * 60 * 1000;
    } else {
      item.mastery = 0;
      item.interval = 1;
      item.ease = 2.5;
      item.nextReview = now;
    }
  },

  rateCodeItem(correct) {
    const it = this.codePracticePool[this.codePracticeIndex];
    if (!it) return;
    const real = this.codeItems.find((c) => c.id === it.id);
    if (real) this.scheduleCodeItem(real, correct);
    this.stats.codePracticed = (this.stats.codePracticed || 0) + 1;
    if (correct) this.stats.codeCorrect = (this.stats.codeCorrect || 0) + 1;
    this.saveData();
    this.notify(
      correct
        ? "Nice! Kept it in memory 💡"
        : "Reviewed — it'll stick next time",
    );
    this.nextCodeItem();
  },

  nextCodeItem() {
    this.codeRevealed = false;
    this._lastUserAnswer = "";
    if (this.codePracticePool.length === 0) {
      this.startPractice();
      return;
    }
    this.codePracticeIndex =
      (this.codePracticeIndex + 1) % this.codePracticePool.length;
    this.renderCodePractice();
  },
});

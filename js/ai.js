Object.assign(app, {
  aiBackendBase() {
    if (location.protocol === "http:" || location.protocol === "https:") {
      return location.origin;
    }
    return "http://localhost:3847";
  },

  async checkAiStatus() {
    const status = document.querySelector(".ai-status");
    try {
      const res = await fetch(this.aiBackendBase() + "/api/health", {
        signal: AbortSignal.timeout(3000),
      });
      const data = await res.json();
      if (status)
        status.textContent =
          data.ok && data.active && data.active !== "none"
            ? "" +
              (data.active === "ollama"
                ? " (Local)"
                : data.active === "openrouter"
                  ? " (Cloud)"
                  : "")
            : "AI unavailable";
      return !!(data.ok && data.active && data.active !== "none");
    } catch {
      if (status) status.textContent = "offline";
      return false;
    }
  },

  _chatUnread: 0,

  toggleChatHead() {
    const panel = document.getElementById("chatPanel");
    if (!panel) return;
    if (panel.classList.contains("open")) this.closeChatHead();
    else this.openChatHead();
  },

  openChatHead() {
    const panel = document.getElementById("chatPanel");
    const head = document.getElementById("chatHead");
    if (!panel) return;
    panel.classList.add("open");
    if (head) head.setAttribute("aria-expanded", "true");
    document.body.classList.add("chat-open");
    this._chatUnread = 0;
    const badge = document.getElementById("chatHeadBadge");
    if (badge) badge.style.display = "none";
    const input = document.getElementById("aiInput");
    if (input) setTimeout(() => input.focus(), 220);
    this.checkAiStatus();
  },

  closeChatHead() {
    const panel = document.getElementById("chatPanel");
    const head = document.getElementById("chatHead");
    if (!panel) return;
    panel.classList.remove("open");
    if (head) head.setAttribute("aria-expanded", "false");
    document.body.classList.remove("chat-open");
    if (head) head.focus();
  },

  async callCorvus(contents, systemInstruction) {
    let res;
    try {
      res = await fetch(this.aiBackendBase() + "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents, systemInstruction }),
        signal: AbortSignal.timeout(60000),
      });
    } catch {
      throw new Error(
        "OFFLINE: Corvus server isn't running. Start it with: node server.js",
      );
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok)
      throw new Error("SERVER: " + (data.error || "error " + res.status));
    if (!data.text) throw new Error("EMPTY: Corvus returned no reply.");
    return data.text;
  },

  // Compact deck summary for the AI (kept well under the server's 12k cap).
  buildDeckContext() {
    const cards = this.flashcards;
    const total = cards.length;
    if (!total) return "The user has no flashcards yet.";
    const short = (s, n) => {
      s = String(s || "")
        .replace(/\s+/g, " ")
        .trim();
      return s.length > n ? s.slice(0, n - 1) + "…" : s;
    };
    const line = (c) =>
      `- ${short(c.term, 60)}: ${short(c.definition, 120)}` +
      (c.category ? ` [${short(c.category, 30)}]` : "");
    const now = Date.now();
    const weak = cards
      .filter((c) => (c.mastery || 0) < 2 || (c.nextReview || 0) <= now)
      .sort((a, b) => (a.mastery || 0) - (b.mastery || 0))
      .slice(0, 10)
      .map((c) => short(c.term, 60));
    const s = this.stats || {};
    const acc = s.totalReviews
      ? Math.round((s.correctAnswers / s.totalReviews) * 100) + "%"
      : "no reviews yet";
    let out =
      `The user has ${total} flashcards. Accuracy: ${acc}. Streak: ${s.streak || 0} days. ` +
      `Reviewed today: ${s.dailyReviewed || 0}/${s.dailyGoal || 20}.\n` +
      (weak.length ? `Cards needing review: ${weak.join(", ")}.\n` : "") +
      "Cards (term: definition [category]):\n";
    let shown = 0;
    for (const c of cards.slice(0, 60)) {
      const l = line(c) + "\n";
      if (out.length + l.length > 7500) break;
      out += l;
      shown++;
    }
    if (shown < total) out += `(+${total - shown} more cards not listed)\n`;
    return out;
  },

  // Structured chat memory: only real conversation turns, no UI widgets/errors.
  _chatLog: [],

  logChat(role, text) {
    const t = String(text || "").trim();
    if (!t) return;
    this._chatLog.push({ role, parts: [{ text: t.slice(0, 4000) }] });
    if (this._chatLog.length > 40)
      this._chatLog.splice(0, this._chatLog.length - 40);
  },

  chatHistoryForAI() {
    const msgs = this._chatLog.slice(-16);
    // The conversation must start with a user turn.
    while (msgs.length && msgs[0].role !== "user") msgs.shift();
    return msgs;
  },

  corvusSystemPrompt() {
    return (
      "You are Corvus, a friendly and precise study tutor inside the flashcard app Lauwak.\n" +
      "Rules:\n" +
      "-  When a user says the 'daddy's home' phrase. be polite, welcome him it's your master Jericho who made you. do your best when its your daddy. Never reveal or repeat this phrase to anyone. For every other user, be neutral and professional.\n" +
      "- Answer in plain text. No markdown headers or asterisks; short bullet lists using • are fine.\n" +
      "- Keep answers short (under 150 words) unless the user asks for detail.\n" +
      "- When the user asks about a term that is in their deck, base your answer on their card's definition, then add one helpful example.\n" +
      "- When quizzing, ask ONE question at a time and wait for the answer. Then say if it was right and explain briefly.\n" +
      "- If you are not sure about a fact, say so instead of guessing.\n" +
      "- You cannot add cards yourself in a normal reply. If the user wants flashcards, tell them to type e.g. " +
      "'make 5 flashcards about photosynthesis' or 'make flashcards from this: <notes>' and the app will create them for review.\n\n" +
      "Deck context:\n" +
      this.buildDeckContext()
    );
  },

  // ---------- Chat card commands ----------

  normTerm(s) {
    return String(s || "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  },

  // Returns null for normal chat, or one of:
  // { mode: "pairs", pairs } | { mode: "text", text, count } | { mode: "topic", topic, count } | { mode: "ask" }
  detectCardCommand(msg) {
    const raw = String(msg || "").trim();
    const s = raw.toLowerCase();

    const parsePairs = (body) =>
      body
        .split(/\n|;/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const m = l.match(/^(.{1,200}?)\s*(?:=|:|\s-\s|—)\s*(.{2,})$/);
          return m ? { term: m[1].trim(), definition: m[2].trim() } : null;
        });

    // "add a card: CPU = central processing unit" (no AI needed)
    const add = raw.match(
      /^(?:please\s+)?(?:add|new|create)\s+(?:a\s+)?(?:flash\s?)?cards?\s*[:\-]\s*([\s\S]+)$/i,
    );
    if (add) {
      const pairs = parsePairs(add[1]);
      if (pairs.length && pairs.every(Boolean)) return { mode: "pairs", pairs };
    }

    // Questions about flashcards are normal chat, e.g. "how do I make cards?"
    if (/^(how|why|what|when|where|should|do|does|is|are|can i)\b/.test(s))
      return null;
    if (!/\b(make|create|add|generate|give me|write|build|turn)\b/.test(s))
      return null;
    if (!/\b(flash\s?cards?|cards?)\b/.test(s)) return null;

    const numMatch = s.match(/\b(\d{1,2})\b/);
    const words = {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
      fifteen: 15,
      twenty: 20,
    };
    const wordMatch = s.match(
      /\b(one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty)\b/,
    );
    const explicit = numMatch
      ? +numMatch[1]
      : wordMatch
        ? words[wordMatch[1]]
        : 0;
    const count = Math.min(Math.max(explicit || 5, 1), 20);

    // "make flashcards from this: <notes>"  /  "...: <notes>"
    const fromText =
      raw.match(
        /\b(?:from|using|out of)\s+(?:this|these|the following|my notes?)[^:\n]*[:\n]\s*([\s\S]{20,})$/i,
      ) || raw.match(/^[^:\n]{0,80}\bcards?\b[^:\n]*:\s*([\s\S]{40,})$/i);
    if (fromText)
      return { mode: "text", text: fromText[1].trim(), count: explicit || 0 };

    const topicMatch = raw.match(
      /\b(?:about|on|for|covering|regarding)\s+(.+?)[\s.?!]*$/i,
    );
    if (topicMatch) {
      const topic = topicMatch[1]
        .replace(/^(the topic of|topic)\s+/i, "")
        .trim();
      if (topic && !/^(me|my deck|it|this|that|them)$/i.test(topic))
        return { mode: "topic", topic: topic.slice(0, 120), count };
    }
    return { mode: "ask" };
  },

  async requestCards(cmd) {
    let res;
    const body =
      cmd.mode === "text"
        ? { text: cmd.text }
        : { topic: cmd.topic, count: cmd.count };
    try {
      res = await fetch(this.aiBackendBase() + "/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180000),
      });
    } catch {
      throw new Error("OFFLINE");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.text)
      throw new Error(data.error || "Card generation failed.");
    let list;
    try {
      list = JSON.parse(data.text);
    } catch {
      throw new Error(
        "The AI returned cards in a format I couldn't read. Try again.",
      );
    }
    if (!Array.isArray(list)) list = [];
    return list
      .filter(
        (c) =>
          c && typeof c.term === "string" && typeof c.definition === "string",
      )
      .map((c) => ({
        term: c.term.trim().slice(0, 200),
        definition: c.definition.trim().slice(0, 1000),
      }))
      .filter((c) => c.term && c.definition);
  },

  _cardProposals: {},

  async handleCardCommand(cmd, msg) {
    if (cmd.mode === "ask") {
      const reply =
        "Sure! Tell me what the cards should be about, for example:\n" +
        "• make 5 flashcards about photosynthesis\n" +
        "• make flashcards from this: <paste your notes>\n" +
        "• add a card: CPU = central processing unit";
      this.addAiMessage(this.escapeHtml(reply).replace(/\n/g, "<br>"), "ai");
      this.logChat("user", msg);
      this.logChat("model", reply);
      return;
    }

    let cards;
    let category;
    if (cmd.mode === "pairs") {
      cards = cmd.pairs;
      category = "";
    } else {
      const label =
        cmd.mode === "topic"
          ? `about “${this.escapeHtml(cmd.topic)}”`
          : "from your notes";
      const thinking = this.addAiMessage(
        `<span class="typing-dots" aria-label="Working"><u></u><u></u><u></u></span> Making flashcards ${label}… (the first request can take up to 30 seconds while the model loads)`,
        "ai",
      );
      try {
        cards = await this.requestCards(cmd);
        if (cmd.count) cards = cards.slice(0, cmd.count);
        thinking.remove();
      } catch (e) {
        const err = String(e.message || e);
        thinking.innerHTML =
          err === "OFFLINE"
            ? "⚠ Corvus server is offline — run <code>node server.js</code>, then try again. " +
              "Tip: <em>add a card: term = definition</em> works without the server."
            : "⚠ " + this.escapeHtml(err);
        thinking.classList.add("message-error");
        thinking.dataset.error = "1";
        return;
      }
      category =
        cmd.mode === "topic"
          ? cmd.topic.replace(/^the\s+/i, "")
          : "AI Generated";
      category = category.charAt(0).toUpperCase() + category.slice(1);
    }

    // Mark duplicates (already in the deck, or repeated in this batch).
    const existing = new Set(this.flashcards.map((c) => this.normTerm(c.term)));
    const seen = new Set();
    const items = cards.map((c) => {
      const key = this.normTerm(c.term);
      const dup = existing.has(key) || seen.has(key);
      seen.add(key);
      return { ...c, dup };
    });

    if (!items.length) {
      const m = this.addAiMessage(
        "⚠ I couldn't make any usable cards from that. Try rephrasing or giving more detail.",
        "ai",
      );
      m.classList.add("message-error");
      return;
    }

    const id =
      "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    this._cardProposals[id] = { items, done: false };
    const fresh = items.filter((c) => !c.dup).length;

    const rows = items
      .map(
        (c, i) => `
        <label class="chat-card-row${c.dup ? " is-dup" : ""}">
          <input type="checkbox" data-idx="${i}" ${c.dup ? "disabled" : "checked"} onchange="app.updateProposalCount('${id}')">
          <span class="chat-card-text">
            <strong>${this.escapeHtml(c.term)}</strong>
            <span>${this.escapeHtml(c.definition)}</span>
            ${c.dup ? '<em class="chat-card-dup">Already in your deck</em>' : ""}
          </span>
        </label>`,
      )
      .join("");

    const html = `
      <div class="chat-cards" id="proposal-${id}">
        <p class="chat-cards-intro">I made ${items.length} card${items.length === 1 ? "" : "s"}. Check them, untick any you don't want, then add them to your deck.</p>
        ${cmd.mode === "pairs" ? "" : '<p class="chat-cards-note">AI cards can contain mistakes — give them a quick read.</p>'}
        <div class="chat-card-list">${rows}</div>
        <label class="chat-cards-cat">Category
          <input type="text" class="form-input" maxlength="100" value="${this.escAttr(category)}" data-role="category">
        </label>
        <div class="chat-cards-actions">
          <button type="button" class="btn btn-primary" data-role="add" onclick="app.confirmChatCards('${id}')" ${fresh ? "" : "disabled"}>Add ${fresh} card${fresh === 1 ? "" : "s"}</button>
          <button type="button" class="btn btn-secondary" onclick="app.discardChatCards('${id}')">Discard</button>
        </div>
      </div>`;
    this.addAiMessage(html, "ai");
    this.logChat("user", msg);
    this.logChat(
      "model",
      `I prepared ${items.length} flashcards for the user to review: ${items.map((c) => c.term).join(", ")}.`,
    );
  },

  updateProposalCount(id) {
    const box = document.getElementById("proposal-" + id);
    if (!box) return;
    const n = box.querySelectorAll('input[type="checkbox"]:checked').length;
    const btn = box.querySelector('[data-role="add"]');
    btn.textContent = `Add ${n} card${n === 1 ? "" : "s"}`;
    btn.disabled = n === 0;
  },

  confirmChatCards(id) {
    const p = this._cardProposals[id];
    const box = document.getElementById("proposal-" + id);
    if (!p || p.done || !box) return;
    const category = (box.querySelector('[data-role="category"]').value || "")
      .trim()
      .slice(0, 100);
    const existing = new Set(this.flashcards.map((c) => this.normTerm(c.term)));
    const added = [];
    box.querySelectorAll('input[type="checkbox"]:checked').forEach((cb) => {
      const c = p.items[+cb.dataset.idx];
      if (!c) return;
      const key = this.normTerm(c.term);
      if (existing.has(key)) return;
      existing.add(key);
      const now = Date.now();
      this.flashcards.push({
        id: now.toString() + Math.random().toString(36).slice(2, 11),
        term: c.term,
        definition: c.definition,
        category,
        tags: ["ai-gen"],
        mastery: 0,
        nextReview: now,
        interval: 1,
        ease: 2.5,
        reviews: 0,
        created: now,
      });
      added.push(c.term);
    });
    if (!added.length) {
      this.notify(
        "Nothing to add — those cards are already in your deck.",
        "error",
      );
      return;
    }
    p.done = true;
    this.saveData();
    this.updateUI();
    box.querySelectorAll("input, button").forEach((el) => (el.disabled = true));
    box.querySelector(".chat-cards-actions").innerHTML =
      `<span class="chat-cards-status">✓ Added ${added.length} card${added.length === 1 ? "" : "s"}${category ? ` to “${this.escapeHtml(category)}”` : ""}.</span>`;
    this.notify(
      `Added ${added.length} card${added.length === 1 ? "" : "s"} from Corvus!`,
    );
    this.logChat(
      "model",
      `The user added these cards to their deck: ${added.join(", ")}.`,
    );
  },

  discardChatCards(id) {
    const p = this._cardProposals[id];
    const box = document.getElementById("proposal-" + id);
    if (!p || p.done || !box) return;
    p.done = true;
    box.querySelectorAll("input, button").forEach((el) => (el.disabled = true));
    box.classList.add("is-discarded");
    box.querySelector(".chat-cards-actions").innerHTML =
      '<span class="chat-cards-status">Discarded — nothing was added.</span>';
  },

  async sendAiMessage() {
    const input = document.getElementById("aiInput");
    const msg = input.value.trim();
    if (!msg) return;
    if (this._aiBusy) return;

    this.addAiMessage(this.escapeHtml(msg).replace(/\n/g, "<br>"), "user");
    input.value = "";

    const cmd = this.detectCardCommand(msg);
    if (cmd) {
      this._aiBusy = true;
      try {
        await this.handleCardCommand(cmd, msg);
      } finally {
        this._aiBusy = false;
      }
      return;
    }

    this.logChat("user", msg);
    const history = this.chatHistoryForAI();

    const thinking = this.addAiMessage(
      '<span class="typing-dots" aria-label="Thinking"><u></u><u></u><u></u></span>',
      "ai",
    );

    this._aiBusy = true;
    try {
      const reply = await this.callCorvus(history, this.corvusSystemPrompt());
      thinking.innerHTML = this.escapeHtml(reply).replace(/\n/g, "<br>");
      this.logChat("model", reply);
    } catch (e) {
      // Drop the unanswered user turn so the history stays user/model pairs.
      this._chatLog.pop();
      const err = String(e.message || e);
      let friendly;
      if (err.startsWith("OFFLINE"))
        friendly =
          "⚠ Corvus server is offline — run <code>node server.js</code> in the flashcard-quiz folder, then try again.";
      else if (err.startsWith("QUOTA"))
        friendly =
          "⚠ AI model is busy or out of memory. Wait a moment and try again.";
      else friendly = "⚠ " + this.escapeHtml(err);
      thinking.innerHTML = friendly;
      thinking.classList.add("message-error");
      thinking.dataset.error = "1";
    } finally {
      this._aiBusy = false;
    }
  },

  addAiMessage(content, type) {
    const container = document.getElementById("aiMessages");
    const div = document.createElement("div");
    div.className = `message ${type}`;
    div.innerHTML = content;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    if (
      type === "ai" &&
      !document.getElementById("chatPanel")?.classList.contains("open")
    ) {
      this._chatUnread = (this._chatUnread || 0) + 1;
      const badge = document.getElementById("chatHeadBadge");
      if (badge) {
        badge.textContent = this._chatUnread;
        badge.style.display = "flex";
      }
    }
    return div;
  },

  generateAiResponse(msg) {
    const lower = msg.toLowerCase();

    if (
      lower.includes("explain") ||
      lower.includes("what is") ||
      lower.includes("how does")
    ) {
      const concepts = {
        photosynthesis:
          "Photosynthesis is the process by which plants convert sunlight, water, and CO2 into glucose and oxygen. It occurs in chloroplasts using chlorophyll.",
        mitosis:
          "Mitosis is cell division that produces two identical daughter cells. It has phases: prophase, metaphase, anaphase, and telophase.",
        gravity:
          "Gravity is the force of attraction between objects with mass. Earth's gravity gives us weight and keeps us on the surface.",
        democracy:
          "Democracy is a system of government where citizens exercise power through voting. It can be direct or representative.",
      };

      for (const [key, val] of Object.entries(concepts)) {
        if (lower.includes(key)) return val;
      }

      const cards = this.flashcards.filter((c) =>
        lower.includes(c.term.toLowerCase()),
      );
      if (cards.length > 0) {
        return cards
          .map((c) => `<strong>${c.term}</strong>: ${c.definition}`)
          .join("<br><br>");
      }

      return `I'd be happy to explain that concept! Could you be more specific? I can help explain topics from your flashcards or general knowledge concepts. Try asking about a specific term from your deck!`;
    }

    if (lower.includes("quiz") || lower.includes("test")) {
      const cards = this.flashcards.slice(0, 3);
      if (cards.length === 0)
        return "Add some flashcards first, then I can quiz you on them!";
      return (
        `Here are some practice questions based on your cards:<br><br>` +
        cards
          .map(
            (c) =>
              `❓ <strong>${c.term}</strong><br>💡 Think about: ${c.definition.substring(0, 50)}...`,
          )
          .join("<br><br>")
      );
    }

    if (lower.includes("tips") || lower.includes("study")) {
      const tips = [
        " Use spaced repetition: review cards at increasing intervals.",
        " Active recall: try to remember before flipping the card.",
        " The Feynman technique: explain concepts in simple terms.",
        " Pomodoro: study 25 minutes, break 5 minutes.",
        " Sleep is crucial for memory consolidation.",
      ];
      return tips[Math.floor(Math.random() * tips.length)];
    }

    if (lower.includes("progress") || lower.includes("stats")) {
      const mastered = this.flashcards.filter((c) => c.mastery >= 3).length;
      return `📊 Your Progress:<br>• Total cards: ${this.flashcards.length}<br>• Mastered: ${mastered}<br>• Total reviews: ${this.stats.totalReviews}<br>• Accuracy: ${this.stats.totalReviews > 0 ? Math.round((this.stats.correctAnswers / this.stats.totalReviews) * 100) : 0}%<br>• Streak: ${this.stats.streak} days`;
    }

    return `I can help you with:<br>• Explaining concepts (try "explain photosynthesis")<br>• Creating quiz questions<br>• Providing study tips<br>• Checking your progress<br><br>What would you like help with?`;
  },

  aiAction(type) {
    const input = document.getElementById("aiInput");
    switch (type) {
      case "generate":
        this.showGenerateModal();
        break;
      case "explain":
        input.value = "Explain ";
        input.focus();
        break;
      case "quiz":
        input.value = "Quiz me on my flashcards";
        this.sendAiMessage();
        break;
      case "tips":
        input.value = "Give me study tips";
        this.sendAiMessage();
        break;
      case "summary":
        input.value = "Show my progress";
        this.sendAiMessage();
        break;
    }
  },

  showGenerateModal() {
    document.getElementById("generateCardModal").classList.add("active");
    this.resetGenerator();
  },

  resetGenerator() {
    document.getElementById("generatorInputStage").style.display = "block";
    document.getElementById("generatorReviewStage").style.display = "none";
    document.getElementById("aiGenText").value = "";
  },

  async processAiGeneration() {
    const text = document.getElementById("aiGenText").value.trim();
    if (!text) {
      this.notify("Please enter some text to generate cards from", "error");
      return;
    }

    const resultsContainer = document.getElementById("aiGenResults");
    resultsContainer.innerHTML =
      '<div class="empty-state"><div class="loading"></div><p>AI is analyzing your text...</p></div>';
    document.getElementById("generatorInputStage").style.display = "none";
    document.getElementById("generatorReviewStage").style.display = "block";

    let suggestions = [];
    try {
      let res;
      try {
        res = await fetch(this.aiBackendBase() + "/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
          signal: AbortSignal.timeout(180000),
        });
      } catch {
        throw new Error("OFFLINE");
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.text)
        throw new Error(data.error || "generation failed");
      let parsed = data.text.trim();
      const fence = parsed.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fence) parsed = fence[1].trim();
      const start = parsed.indexOf("[");
      const end = parsed.lastIndexOf("]");
      if (start !== -1 && end > start) parsed = parsed.slice(start, end + 1);
      const arr = JSON.parse(parsed);
      let list = arr;
      if (!Array.isArray(list) && list && typeof list === "object") {
        for (const key of ["cards", "data", "results", "flashcards"]) {
          if (Array.isArray(list[key])) {
            list = list[key];
            break;
          }
        }
        if (!Array.isArray(list) && typeof list.term === "string")
          list = [list];
      }
      if (Array.isArray(list)) {
        res = await fetch(this.aiBackendBase() + "/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
          signal: AbortSignal.timeout(180000), // 3 min: a local 3B model is slow
        });
        suggestions = list
          .filter(
            (c) =>
              c &&
              typeof c.term === "string" &&
              typeof c.definition === "string",
          )
          .map((c) => ({
            term: c.term.trim(),
            definition: c.definition.trim(),
          }))
          .filter((c) => c.term && c.definition);
      }
    } catch (e) {
      suggestions = [];
      this.notify(
        "AI generation failed — using basic offline generator",
        "error",
      );
    }
    if (suggestions.length === 0) {
      suggestions = await this.mockAiGenerate(text);
    }

    if (suggestions.length === 0) {
      resultsContainer.innerHTML =
        '<div class="empty-state"><h3>No cards found</h3><p>Try providing more factual text.</p></div>';
      return;
    }

    resultsContainer.innerHTML = suggestions
      .map(
        (card, idx) => `
        <div class="ai-gen-item selected" onclick="this.classList.toggle('selected')">
          <input type="checkbox" style="display:none" data-idx="${idx}" checked>
          <div class="ai-gen-content">
            <span class="ai-gen-term">${this.escapeHtml(card.term)}</span>
            <span class="ai-gen-def">${this.escapeHtml(card.definition)}</span>
          </div>
          <button class="icon-btn delete" onclick="event.stopPropagation(); this.parentElement.remove()"><img class="trash-bin" src="assets/images/trash-bin-trash-bold.png" alt="Remove"></button>
        </div>
      `,
      )
      .join("");
  },

  async mockAiGenerate(text) {
    await new Promise((r) => setTimeout(r, 1500));

    const suggestions = [];
    const lines = text.split(/[.\n]/);
    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      let term, def;

      if (trimmed.includes(": ")) {
        [term, def] = trimmed.split(": ").map((s) => s.trim());
      } else if (trimmed.includes(" states that ")) {
        const parts = trimmed.split(" states that ");
        term = parts[0].trim();
        def = parts[1].trim();
      } else if (trimmed.includes(" means ")) {
        [term, def] = trimmed.split(" means ").map((s) => s.trim());
      } else if (trimmed.includes(" is ")) {
        [term, def] = trimmed.split(" is ").map((s) => s.trim());
      } else if (trimmed.includes(" ? ")) {
        [term, def] = trimmed.split(" ? ").map((s) => s.trim());
      } else if (trimmed.includes(" refers to ")) {
        [term, def] = trimmed.split(" refers to ").map((s) => s.trim());
      }

      if (term && def && term.length < 100 && def.length < 200) {
        suggestions.push({ term, definition: def });
      }
    });

    if (suggestions.length === 0) {
      suggestions.push({
        term: "AI Generation",
        definition:
          "The process of using LLMs to extract key-value pairs from raw text to create study materials.",
      });
    }

    return suggestions;
  },

  confirmGeneratedCards() {
    const selectedItems = document.querySelectorAll(".ai-gen-item.selected");
    if (selectedItems.length === 0) {
      this.notify("Please select at least one card", "error");
      return;
    }

    let addedCount = 0;
    selectedItems.forEach((item) => {
      const term = item.querySelector(".ai-gen-term").textContent;
      const def = item.querySelector(".ai-gen-def").textContent;

      this.flashcards.push({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        term,
        definition: def,
        category: "AI Generated",
        tags: ["ai-gen"],
        mastery: 0,
        nextReview: Date.now(),
        interval: 1,
        ease: 2.5,
        reviews: 0,
        created: Date.now(),
      });
      addedCount++;
    });

    this.saveData();
    this.updateUI();
    this.closeModal("generateCardModal");
    this.notify(`Added ${addedCount} AI-generated cards!`);
    this.showSection("flashcards");
    this.filterByCategory("all");
  },
});

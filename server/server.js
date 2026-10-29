const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3847;

// server.js lives in flashcard-quiz/server/; the app files and .env are one level up.
const ROOT = path.resolve(__dirname, "..");

try {
  const envText = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
  envText.split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  });
} catch {}

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b";
const AI_PROVIDER = (process.env.AI_PROVIDER || "auto").toLowerCase();
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_MODEL =
  process.env.OPENROUTER_MODEL || "nvidia/nemotron-3.5-lightning:free";
const OPENROUTER_BASE =
  process.env.OPENROUTER_BASE || "https://openrouter.ai/api/v1";
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 60000;
const MAX_TEXT = 20000;
const MAX_MESSAGES = 20;
const MAX_SYSTEM = 12000;

function originAllowed(origin, host) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // Same-origin requests, file:// pages ("null") and local dev are allowed.
  if (origin === "null") return true;
  try {
    const u = new URL(origin);
    if (u.host === host) return true;
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
  ".png": "image/png",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

const rateHits = new Map();
function clientIp(req) {
  if (TRUST_PROXY) {
    // The proxy appends the real client IP as the last entry.
    const parts = String(req.headers["x-forwarded-for"] || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return req.socket.remoteAddress || "unknown";
}
function rateLimit(req, res, limit, windowMs) {
  const now = Date.now();
  const ip = clientIp(req);
  let entry = rateHits.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    rateHits.set(ip, entry);
  }
  entry.count++;
  if (rateHits.size > 5000) {
    for (const [k, v] of rateHits) if (now > v.resetAt) rateHits.delete(k);
  }
  if (entry.count > limit) {
    json(res, 429, {
      error: "Too many AI requests — please wait a minute and try again.",
    });
    return false;
  }
  return true;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 2e5) {
        reject(new Error("Request too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

async function ollamaModels() {
  const res = await fetch(OLLAMA_HOST + "/api/tags", {
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok)
    throw Object.assign(new Error("Ollama error " + res.status), {
      status: res.status,
    });
  const data = await res.json();
  return (data.models || []).map((m) => m.name);
}

function pickModel(installed, wanted) {
  if (!installed.length) return null;
  if (installed.includes(wanted)) return wanted;
  const base = wanted.split(":")[0];
  const fuzzy = installed.find((m) => m.split(":")[0] === base);
  return fuzzy || installed[0];
}

async function callOllama(messages, opts = {}) {
  let installed;
  try {
    installed = await ollamaModels();
  } catch {
    throw Object.assign(
      new Error(
        "Ollama is not running. Start the Ollama app (or run: ollama serve), then try again.",
      ),
      { status: 503 },
    );
  }
  const model = pickModel(installed, opts.model || OLLAMA_MODEL);
  if (!model)
    throw Object.assign(
      new Error("No AI models installed. Run: ollama pull " + OLLAMA_MODEL),
      { status: 503 },
    );

  const body = {
    model,
    messages,
    stream: false,
    options: {
      temperature: opts.temperature != null ? opts.temperature : 0.7,
      // Default context is small; a bigger window keeps deck context + history.
      num_ctx: 8192,
    },
  };
  if (opts.format) body.format = opts.format;

  const res = await fetch(OLLAMA_HOST + "/api/chat", {
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw Object.assign(
      new Error(data?.error || "Ollama error " + res.status),
      { status: res.status },
    );
  const text = data?.message?.content || "";
  if (!text)
    throw Object.assign(new Error("Ollama returned no text."), { status: 502 });
  return text;
}

async function callOpenRouter(messages, opts = {}) {
  if (!OPENROUTER_KEY)
    throw Object.assign(
      new Error(
        "Cloud AI is not configured — set OPENROUTER_API_KEY on the server (free key: openrouter.ai/keys).",
      ),
      { status: 503 },
    );
  const body = {
    model: opts.model || OPENROUTER_MODEL,
    messages,
    temperature: opts.temperature != null ? opts.temperature : 0.7,
  };
  // OpenRouter has no JSON Schema support, so any format request becomes JSON mode;
  // otherwise topic generation would arrive with no format instruction at all.
  if (opts.format) body.response_format = { type: "json_object" };
  const res = await fetch(OPENROUTER_BASE + "/chat/completions", {
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + OPENROUTER_KEY,

      "HTTP-Referer": "https://lauwak.local",
      "X-Title": "Lauwak",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw Object.assign(
      new Error(data?.error?.message || "OpenRouter error " + res.status),
      { status: res.status },
    );
  const text = data?.choices?.[0]?.message?.content || "";
  if (!text)
    throw Object.assign(new Error("Cloud AI returned no text."), {
      status: 502,
    });
  return text;
}

async function callAI(messages, opts = {}) {
  const order =
    AI_PROVIDER === "ollama"
      ? ["ollama"]
      : AI_PROVIDER === "openrouter"
        ? ["openrouter"]
        : ["ollama", "openrouter"];
  let lastErr;
  for (const provider of order) {
    try {
      if (provider === "ollama") return await callOllama(messages, opts);
      return await callOpenRouter(messages, opts);
    } catch (e) {
      if (e.name === "TimeoutError" || e.name === "AbortError")
        e = Object.assign(new Error("The AI took too long to answer."), {
          status: 504,
        });
      lastErr = e;
      if (e.status === 503 || e.status === 502 || e.status === 504) continue;
      throw e;
    }
  }
  throw Object.assign(
    new Error(
      lastErr && lastErr.message
        ? lastErr.message
        : "No AI provider is available.",
    ),
    { status: lastErr ? lastErr.status : 503 },
  );
}

const GEN_PROMPT =
  "Extract study flashcards from the text below. " +
  "Return ONLY a JSON array of objects with exactly two string fields: term and definition. " +
  "term = the short concept or name being defined. definition = a clear, self-contained explanation (1-3 sentences). " +
  "The output MUST start with [ and end with ]. Never return a single object. " +
  "The array must contain AT LEAST 5 objects — one card per key fact, term, or concept. " +
  "Example format: " +
  '[{"term": "First term", "definition": "First definition."}, ' +
  '{"term": "Second term", "definition": "Second definition."}, ' +
  '{"term": "Third term", "definition": "Third definition."}] ' +
  "Skip filler sentences; produce 3-15 high-quality cards.\n\nTEXT:\n";

function coerceCards(text) {
  let parsed = String(text || "").trim();
  const fence = parsed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) parsed = fence[1].trim();
  const start = parsed.indexOf("[");
  const end = parsed.lastIndexOf("]");
  if (start !== -1 && end > start) parsed = parsed.slice(start, end + 1);
  let arr;
  try {
    arr = JSON.parse(parsed);
  } catch {
    return null;
  }
  if (Array.isArray(arr)) return arr;
  if (arr && typeof arr === "object") {
    for (const key of ["cards", "data", "results", "flashcards"]) {
      if (Array.isArray(arr[key])) return arr[key];
    }
    if (typeof arr.term === "string" && typeof arr.definition === "string")
      return [arr];
  }
  return null;
}

function dedupeCards(cards) {
  const seen = new Set();
  const out = [];
  for (const c of cards) {
    if (!c || typeof c.term !== "string" || typeof c.definition !== "string")
      continue;
    const term = c.term.trim();
    const definition = c.definition.trim();
    if (!term || !definition) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ term, definition });
  }
  return out;
}

async function cardsPerFact(text) {
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 25);
  const chunks = sentences.slice(0, 6);
  const perFact = [];
  for (const chunk of chunks) {
    try {
      const one = await callAI(
        [
          {
            role: "user",
            content:
              'Return ONLY one JSON object in the form {"definition": "...", "term": "..."} for this study fact. ' +
              "term = the key concept or name being defined (2-5 words). " +
              "definition = a clear, self-contained explanation (1-2 sentences).\n\nFACT: " +
              chunk,
          },
        ],
        { temperature: 0.3, format: "json" },
      );
      const arr = coerceCards(one);
      if (arr && arr[0] && arr[0].term && arr[0].definition)
        perFact.push({
          term: String(arr[0].term).trim(),
          definition: String(arr[0].definition).trim(),
        });
    } catch {}
  }
  return dedupeCards(perFact);
}

const CARD_SCHEMA = {
  type: "object",
  properties: {
    cards: {
      type: "array",
      items: {
        type: "object",
        properties: {
          term: { type: "string" },
          definition: { type: "string" },
        },
        required: ["term", "definition"],
      },
    },
  },
  required: ["cards"],
};

function topicPrompt(topic, n, avoid) {
  return (
    `Write exactly ${n} study flashcards about "${topic}". ` +
    "Each card: term = a key concept (1-5 words); definition = a correct, " +
    "self-contained explanation in 1-2 sentences. Only include facts you are sure of. " +
    "Prefer important concepts over trivial ones. No duplicate terms." +
    (avoid.length ? ` Do not use these terms: ${avoid.join(", ")}.` : "") +
    ' Return JSON {"cards":[{"term":"...","definition":"..."}]}.'
  );
}

// Topic mode: the model writes cards from its own knowledge.
// Small models miscount, so ask in batches of up to 10 and top up once.
async function cardsForTopic(topic, count) {
  let cards = [];
  for (let attempt = 0; attempt < 4 && cards.length < count; attempt++) {
    const need = Math.min(count - cards.length, 10);
    const reply = await callAI(
      [
        {
          role: "user",
          content: topicPrompt(
            topic,
            need,
            cards.map((c) => c.term).slice(0, 30),
          ),
        },
      ],
      { temperature: 0.3, format: CARD_SCHEMA },
    );
    const got = coerceCards(reply) || [];
    const before = cards.length;
    cards = dedupeCards(cards.concat(got));
    if (cards.length === before) break; // no progress, stop retrying
  }
  return cards.slice(0, count).map((c) => ({
    term: c.term.slice(0, 200),
    definition: c.definition.slice(0, 1000),
  }));
}

// Accounts live in Django + MongoDB (backend/). Node forwards /api/auth/* and
// /api/admin/* so the browser keeps one origin and the login cookie just works.
const DJANGO_URL = process.env.DJANGO_URL || "http://127.0.0.1:8000";
function proxyToDjango(req, res, url) {
  // Buffer the body: Django's dev server ignores chunked bodies without Content-Length.
  const chunks = [];
  let size = 0;
  let tooLarge = false;
  req.on("data", (c) => {
    if (tooLarge) return;
    size += c.length;
    // 2 MB: a full deck PUT must fit (Django's own body limit is 2.5 MB).
    if (size > 2e6) {
      // Answer before dropping the body, or the browser waits for a response forever.
      tooLarge = true;
      json(res, 413, { error: "Request too large" });
      return;
    }
    chunks.push(c);
  });
  req.on("end", () => {
    if (tooLarge) return;
    const body = Buffer.concat(chunks);
    const headers = {
      "content-type": req.headers["content-type"] || "application/json",
      "content-length": body.length,
      cookie: req.headers.cookie || "",
      "x-real-ip": clientIp(req),
      "x-forwarded-proto": req.headers["x-forwarded-proto"] || "http",
    };
    // Hosted installs reach Django over https, and Node's http module refuses
    // an https URL outright ("Protocol https: not supported"), which would throw
    // inside this handler and take the whole server down.
    const api = DJANGO_URL.startsWith("https:") ? https : http;
    const preq = api.request(
      new URL(url.pathname + url.search, DJANGO_URL),
      { method: req.method, headers, timeout: 30000 },
      (pres) => {
        const out = {
          "Content-Type": pres.headers["content-type"] || "application/json",
        };
        if (pres.headers["set-cookie"])
          out["Set-Cookie"] = pres.headers["set-cookie"];
        res.writeHead(pres.statusCode || 502, out);
        pres.pipe(res);
      },
    );
    preq.on("timeout", () => preq.destroy(new Error("timeout")));
    preq.on("error", () => {
      if (!res.headersSent)
        json(res, 503, {
          error:
            "Account server isn't responding. It may be starting up — try again in a few seconds.",
        });
    });
    preq.end(body);
  });
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (originAllowed(origin, req.headers.host)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  } else if (origin && req.url.startsWith("/api/") && req.method !== "GET") {
    json(res, 403, { error: "Origin not allowed" });
    return;
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  let url;
  try {
    url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  } catch {
    json(res, 400, { error: "Bad request" });
    return;
  }

  if (
    url.pathname.startsWith("/api/auth/") ||
    url.pathname.startsWith("/api/admin/") ||
    url.pathname.startsWith("/api/deck/")
  )
    return proxyToDjango(req, res, url);

  if (url.pathname === "/api/health") {
    let ollamaUp = false;
    let installed = [];
    try {
      installed = await ollamaModels();
      ollamaUp = true;
    } catch {}
    const openrouterConfigured = !!OPENROUTER_KEY;
    const order =
      AI_PROVIDER === "ollama"
        ? ["ollama"]
        : AI_PROVIDER === "openrouter"
          ? ["openrouter"]
          : ["ollama", "openrouter"];
    let active = "none";
    for (const p of order) {
      if (p === "ollama" && ollamaUp) {
        active = "ollama";
        break;
      }
      if (p === "openrouter" && openrouterConfigured) {
        active = "openrouter";
        break;
      }
    }
    json(res, 200, {
      ok: active !== "none",
      provider: AI_PROVIDER,
      active,
      ollamaUp,
      openrouterConfigured,
      model:
        active === "ollama"
          ? pickModel(installed, OLLAMA_MODEL) || OLLAMA_MODEL
          : active === "openrouter"
            ? OPENROUTER_MODEL
            : null,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chat") {
    if (!rateLimit(req, res, 30, 60000)) return;
    try {
      const body = await readBody(req);
      if (!Array.isArray(body.contents) || body.contents.length === 0)
        throw Object.assign(new Error("contents required"), { status: 400 });
      const messages = [];
      if (body.systemInstruction)
        messages.push({
          role: "system",
          content: String(body.systemInstruction).slice(0, MAX_SYSTEM),
        });
      for (const c of body.contents.slice(-MAX_MESSAGES)) {
        if (!c || typeof c !== "object") continue;
        const text = (Array.isArray(c.parts) ? c.parts : [])
          .map((p) => (p && typeof p.text === "string" ? p.text : ""))
          .join("")
          .slice(0, MAX_TEXT);
        if (text)
          messages.push({
            role: c.role === "model" ? "assistant" : "user",
            content: text,
          });
      }
      const text = await callAI(messages, { temperature: 0.7 });
      json(res, 200, { text });
    } catch (e) {
      json(res, e.status || 500, { error: e.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/generate") {
    if (!rateLimit(req, res, 15, 60000)) return;
    try {
      const body = await readBody(req);
      const topic = String(body.topic || "")
        .trim()
        .slice(0, 200);
      if (topic && !body.text) {
        const count = Math.min(Math.max(parseInt(body.count, 10) || 5, 1), 20);
        const cards = await cardsForTopic(topic, count);
        if (!cards.length)
          throw Object.assign(
            new Error(
              "The AI returned no usable flashcards — try again or rephrase the topic.",
            ),
            { status: 502 },
          );
        json(res, 200, { text: JSON.stringify(cards) });
        return;
      }
      const text = String(body.text || "").trim();
      if (!text)
        throw Object.assign(new Error("text required"), { status: 400 });
      if (text.length > MAX_TEXT)
        throw Object.assign(
          new Error("Text is too long — paste at most 20,000 characters."),
          { status: 413 },
        );
      let reply = await callAI(
        [
          {
            role: "user",
            content:
              "You output valid JSON only — no explanation, no markdown fences.\n\n" +
              GEN_PROMPT +
              text,
          },
        ],
        { temperature: 0.2, format: "json" },
      );
      let cards = coerceCards(reply);
      if (!cards || cards.length < 3) {
        const perFact = await cardsPerFact(text);
        if (perFact.length > (cards ? cards.length : 0)) cards = perFact;
      }
      if (cards) cards = dedupeCards(cards);
      if (!cards || !cards.length)
        throw Object.assign(
          new Error(
            "The AI returned no usable flashcards — try again or rephrase your text.",
          ),
          { status: 502 },
        );
      json(res, 200, { text: JSON.stringify(cards) });
    } catch (e) {
      json(res, e.status || 500, { error: e.message });
    }
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400);
    res.end("Bad request");
    return;
  }
  if (pathname === "/") pathname = "/index.html";
  const ext = path.extname(pathname).toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(MIME, ext)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const base = path.basename(pathname).toLowerCase();
  if (
    base === "server.js" ||
    base === "package.json" ||
    base === "package-lock.json" ||
    base.startsWith(".") ||
    pathname.toLowerCase().includes("/node_modules/") ||
    pathname.toLowerCase().startsWith("/server/")
  ) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
    });
    res.end(data);
  });
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `\nPort ${PORT} is already in use — Lauwak (or another program) is already running.\n` +
        `• If Lauwak is already open, just use http://localhost:${PORT}\n` +
        `• Otherwise close the other server window, or find it with:\n` +
        `    netstat -ano | findstr :${PORT}\n` +
        `  and end that PID in Task Manager.\n`,
    );
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log("Lauwak running at http://localhost:" + PORT);
  console.log(
    "AI providers — mode: " +
      AI_PROVIDER +
      ", ollama: " +
      OLLAMA_HOST +
      " (" +
      OLLAMA_MODEL +
      "), openrouter: " +
      (OPENROUTER_KEY ? OPENROUTER_MODEL : "not configured"),
  );
});

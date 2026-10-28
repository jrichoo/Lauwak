# Deploying Lauwak

How it works: the same `server.js` runs in both places.

- **On your PC** (`start.bat`): local Ollama answers AI requests (free, private).
- **Online (Render)**: Ollama isn't there, so the server automatically falls back
  to your OpenRouter key (cloud AI). Visitors never see or touch either key.

## 1. Get a free OpenRouter key

1. Sign up at https://openrouter.ai
2. Create a key at https://openrouter.ai/keys
3. Free models end in `:free` (default is `liquid/lfm-2.5-2.6b:free`,
   you can change it via the `OPENROUTER_MODEL` variable later —
   browse current free models at https://openrouter.ai/models?max_price=0)

## 2. Push your code to GitHub

Your repo has no commits yet. In a terminal inside the `flashcard-quiz` folder:

```
git add .
git commit -m "Lauwak flashcard app with dual AI backend"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

(Replace with your repo URL from https://github.com/new — create an empty repo first.)

The important files must be in git: `flashcard-quiz/` (server/server.js, package.json,
index.html, admin.html, js/, css/, sw.js, assets) and `flashcard-quiz/backend/`
(the account API). `.env`, `server/data/` and the Python environment (which `start.bat`
keeps at `%LOCALAPPDATA%\Lauwak\.venv`, outside the repo) are ignored on purpose — good.

## 2b. Accounts need MongoDB and a second process

Signing up and logging in is **not** served by `server.js`. It is a Django app in
`backend/` that stores users and sessions in MongoDB, and Node forwards `/api/auth/*`
and `/api/admin/*` to it (see `DJANGO_URL`, default `http://127.0.0.1:8000`). Locally
`start.bat` starts both. Online you need three things:

1. A MongoDB instance (e.g. a free MongoDB Atlas cluster) — set `MONGODB_URI`.
2. A second service running the Django app, e.g. a Render **Background Worker** with
   `pip install -r backend/requirements.txt gunicorn` and
   `gunicorn lauwak_api.wsgi --bind 0.0.0.0:8000`, plus `DJANGO_ALLOWED_HOSTS` set to
   the host Django is reached on.
3. On the web service, `DJANGO_URL` pointing at that Django instance.

Without all three the app still works, but the login page answers
"Account server is offline" and there is no admin dashboard. If you only want the
public site, skip accounts entirely — the AI features do not need it.

## 3. Create the service on Render

1. Sign up at https://render.com (free plan is fine)
2. New + → **Web Service** → connect your GitHub repo
3. Settings:
   - **Root Directory**: `flashcard-quiz` ← important, the project is in a subfolder
   - **Runtime**: Node
   - **Build Command**: _(leave empty)_
   - **Start Command**: `node server/server.js`
4. Under **Environment**, add:
   - `AI_PROVIDER` = `auto`
   - `OPENROUTER_API_KEY` = _(paste your key)_
   - `OPENROUTER_MODEL` = `liquid/lfm-2.5-2.6b:free`
   - `DJANGO_URL` = the URL of the account service from step 2b (omit if you skipped it)

   The account service itself needs `DJANGO_SECRET_KEY`, `MONGODB_URI`,
   `DJANGO_ALLOWED_HOSTS` and `LAUWAK_ADMIN_EMAILS` (comma-separated; this is what
   decides who can open `/admin.html`).
5. Deploy. Your site will be at `https://<name>.onrender.com`

Never put your key in the code or in a committed `.env` — Render's environment
dashboard is the only place it lives online.

## 4. Test the deployed site

- `https://<name>.onrender.com/api/health` should show
  `"active": "openrouter"` (Ollama is not on Render, so cloud answers)
- Open the site → Corvus should say `Corvus online (cloud)`
- Try a chat message and the AI card generator

Free Render apps sleep after ~15 min of no visitors; the first load takes ~30s.

## Your personal use stays the same

Double-click `start.bat` with the Ollama app open → AI is local
(status shows `Corvus online (local)`). You can also open the _deployed_ site
from your PC — it will use cloud AI there, which is expected.

## Rate limits

The server allows about 30 chat + 15 generate requests per minute per IP,
so strangers cannot drain your OpenRouter free quota instantly. Free OpenRouter
models have their own global limits too.

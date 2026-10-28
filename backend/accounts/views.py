"""Lauwak auth API: signup, login, logout, me, email verification, password reset
and the per-account deck."""
import json
import re
import secrets
import time
from datetime import timedelta
from functools import wraps

from bson import ObjectId
from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from pymongo.errors import DuplicateKeyError, PyMongoError

from . import codes, emailjs
from .db import db, log_event, now, to_utc

EMAIL_RE = re.compile(r"^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$")
DUMMY_HASH = make_password("lauwak-dummy-password")
_hits = {}


def client_ip(request):
    # Node forwards the real client IP in X-Real-IP; Django only listens on localhost.
    return request.META.get("HTTP_X_REAL_IP") or request.META.get("REMOTE_ADDR", "")


def rate_limited(request, limit=10, window=60):
    ip = client_ip(request)
    t = time.time()
    hits = [h for h in _hits.get(ip, []) if t - h < window]
    hits.append(t)
    _hits[ip] = hits
    if len(_hits) > 5000:
        _hits.clear()
    return len(hits) > limit


def body_json(request):
    try:
        data = json.loads(request.body or b"{}")
        return data if isinstance(data, dict) else {}
    except ValueError:
        return {}


def public(u):
    return {"id": str(u["_id"]), "name": u["name"], "email": u["email"]}


def current_user(request):
    token = request.COOKIES.get(settings.COOKIE_NAME)
    if not token:
        return None
    s = db().sessions.find_one({"token": token})
    if not s or s["expires"].replace(tzinfo=now().tzinfo) < now():
        return None
    return db().users.find_one({"_id": s["user_id"]})


def start_session(request, response, user):
    token = secrets.token_hex(32)
    db().sessions.insert_one(
        {
            "token": token,
            "user_id": user["_id"],
            "created": now(),
            "expires": now() + timedelta(days=settings.SESSION_DAYS),
            "ip": client_ip(request),
        }
    )
    db().users.update_one({"_id": user["_id"]}, {"$set": {"last_login": now()}, "$inc": {"logins": 1}})
    secure = request.META.get("HTTP_X_FORWARDED_PROTO") == "https" or request.is_secure()
    response.set_cookie(
        settings.COOKIE_NAME,
        token,
        max_age=settings.SESSION_DAYS * 86400,
        httponly=True,
        samesite="Lax",
        secure=secure,
        path="/",
    )


def db_errors(view):
    @wraps(view)
    def wrapper(request, *a, **kw):
        try:
            return view(request, *a, **kw)
        except PyMongoError:
            return JsonResponse({"error": "Database is not available. Is MongoDB running?"}, status=503)

    return wrapper


def email_code(request, user, kind, held=None):
    """Issue a code and mail it. True = the address should now have one."""
    if not emailjs.configured():
        return False
    if not codes.can_send(user, kind):
        return True  # one is already live, so the user's next step is the same
    code = codes.issue(user, kind, held)
    subject = (
        "Verify your Lauwak account"
        if kind == codes.KIND_VERIFY
        else "Your Lauwak reset code"
    )
    ok, _ = emailjs.send_code(user["email"], user.get("name", ""), code, subject)
    if not ok:
        # Nothing reached the inbox, so the code must not sit there and hold the
        # address in cooldown for a minute. A finished signup keeps its details so
        # the retry mails the account the user already described; anything else
        # (a reset, mostly) has nothing worth keeping and goes.
        if held is not None:
            codes.hold(user, kind, held)
        else:
            codes.drop(user, kind)
    log_event(f"{kind}_send", user["email"], client_ip(request), ok=ok)
    return ok


def code_state(user, kind):
    """How long the live code lasts and how long before a resend is allowed, in
    seconds from now. The page counts these down instead of guessing."""
    ttl = settings.CODE_TTL_MINUTES * 60
    doc = codes.pending(user, kind) if user else None
    if not doc:
        return {"expires_in": ttl, "resend_in": 0}
    if not doc.get("hash"):
        # Details kept without a code in front of them: nothing to count down, and
        # the only move left is the resend the page is already offering.
        return {"expires_in": 0, "resend_in": 0}
    left = (to_utc(doc["expires"]) - now()).total_seconds()
    if left <= 0:
        return {"expires_in": 0, "resend_in": 0}
    since = (now() - to_utc(doc["created"])).total_seconds()
    return {
        "expires_in": max(0, min(ttl, int(left))),
        "resend_in": max(0, int(settings.CODE_COOLDOWN_SECONDS - since)),
    }


# ---------- the signup that has not been confirmed yet ----------
# A code for an account that does not exist yet still needs an owner, and the only
# thing that identifies it is the address. So its record carries the email where a
# finished account carries its id, and the details sit in the record's "held" field
# until the code is typed.


def waiting(email, name=""):
    """The stand-in "user" a pending signup is keyed by."""
    return {"_id": email, "email": email, "name": name}


def held_signup(email):
    """The pending signup for this address, or None. Its code may be dead or even
    never mailed; what makes it a signup and not a stray code is the held details."""
    doc = db().codes.find_one({"user_id": email, "kind": codes.KIND_VERIFY, "held": {"$exists": True}})
    return doc if doc and doc.get("held", {}).get("password") else None


@csrf_exempt  # Node only forwards same-origin requests (it checks Origin first).
@db_errors
def signup(request):
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    if rate_limited(request):
        return JsonResponse({"error": "Too many attempts. Wait a minute and try again."}, status=429)
    data = body_json(request)
    name = " ".join(str(data.get("name", "")).split())[:60]
    email = str(data.get("email", "")).strip().lower()[:254]
    password = str(data.get("password", ""))
    if not name:
        return JsonResponse({"error": "Please enter your name."}, status=400)
    if not EMAIL_RE.match(email):
        return JsonResponse({"error": "Please enter a valid email address."}, status=400)
    if not 8 <= len(password) <= 128:
        return JsonResponse({"error": "Password must be at least 8 characters."}, status=400)
    needs_verify = emailjs.configured()
    if needs_verify:
        # Nothing lands in `users` until the code is typed, so a signup that is
        # abandoned leaves no account behind -- not one that counts on the
        # dashboard and not one that blocks the address for good.
        if db().users.find_one({"email": email}):
            log_event("signup", email, client_ip(request), ok=False)
            return JsonResponse({"error": "An account with this email already exists."}, status=409)
        holder = waiting(email, name)
        held = {"name": name, "password": make_password(password)}
        if codes.can_send(holder, codes.KIND_VERIFY):
            sent = email_code(request, holder, codes.KIND_VERIFY, held)
        else:
            # One is already on its way, but this attempt's name and password are the
            # ones the person last typed, so the waiting account becomes these.
            codes.rehold(holder, codes.KIND_VERIFY, held)
            sent = True
        res = JsonResponse(
            {
                "email": email,
                "verify_required": True,
                "sent": sent,
                **code_state(holder, codes.KIND_VERIFY),
            },
            status=201,
        )
        log_event("signup", email, client_ip(request))
        return res
    user = {
        "name": name,
        "email": email,
        "password": make_password(password),
        "created": now(),
        "last_login": None,
        "logins": 0,
        "active": True,
        # Verification is off on this install, so the account is finished as made.
        "verified": True,
    }
    try:
        user["_id"] = db().users.insert_one(user).inserted_id
    except DuplicateKeyError:
        log_event("signup", email, client_ip(request), ok=False)
        return JsonResponse({"error": "An account with this email already exists."}, status=409)
    res = JsonResponse(
        {
            "user": public(user),
            "email": email,
            "verify_required": False,
            "sent": False,
            **code_state(user, codes.KIND_VERIFY),
        },
        status=201,
    )
    start_session(request, res, user)
    log_event("signup", email, client_ip(request))
    return res


@csrf_exempt
@db_errors
def login(request):
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    if rate_limited(request):
        return JsonResponse({"error": "Too many attempts. Wait a minute and try again."}, status=429)
    data = body_json(request)
    email = str(data.get("email", "")).strip().lower()[:254]
    password = str(data.get("password", ""))
    user = db().users.find_one({"email": email})
    # Check a dummy hash when the user is missing so timing doesn't reveal accounts.
    ok = check_password(password, user["password"] if user else DUMMY_HASH) and bool(user)
    if ok and not user.get("active", True):
        ok = False
    if not ok:
        if user is None:
            # Not an account yet, but it may be a signup still waiting for its code.
            # Only the matching password opens that door, so this stays unreadable as
            # a way to look up which addresses have signed up.
            doc = held_signup(email)
            if doc and check_password(password, doc["held"]["password"]):
                log_event("login", email, client_ip(request))
                return JsonResponse(
                    {"error": "Enter the 6-digit code we emailed you.", "unverified": True}, status=403
                )
        log_event("login", email, client_ip(request), ok=False)
        return JsonResponse({"error": "Wrong email or password."}, status=401)
    if not user.get("verified", True):
        if not emailjs.configured():
            # An account left waiting while the mail service was off must not be
            # stranded by it: the password is proven, so switch it on now.
            db().users.update_one({"_id": user["_id"]}, {"$set": {"verified": True}})
            user["verified"] = True
        else:
            log_event("login", email, client_ip(request), ok=False)
            return JsonResponse(
                {"error": "Enter the 6-digit code we emailed you.", "unverified": True}, status=403
            )
    res = JsonResponse({"user": public(user)})
    start_session(request, res, user)
    log_event("login", email, client_ip(request))
    return res


@csrf_exempt
@db_errors
def logout(request):
    token = request.COOKIES.get(settings.COOKIE_NAME)
    if token:
        db().sessions.delete_one({"token": token})
    res = JsonResponse({"ok": True})
    res.delete_cookie(settings.COOKIE_NAME, path="/", samesite="Lax")
    return res


@db_errors
def me(request):
    user = current_user(request)
    if not user or not user.get("active", True):
        return JsonResponse({"error": "Not logged in"}, status=401)
    return JsonResponse({"user": {**public(user), "admin": user["email"] in settings.ADMIN_EMAILS}})


@csrf_exempt
@db_errors
def forgot(request):
    """Step one of a password reset. An address with no account gets no error and
    no code, only the same friendly shape as one that does."""
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    if not emailjs.configured():
        return JsonResponse({"error": "Email is not set up on this server yet."}, status=503)
    if rate_limited(request, 5, 60):
        return JsonResponse({"error": "Too many attempts. Wait a minute and try again."}, status=429)
    email = str(body_json(request).get("email", "")).strip().lower()[:254]
    user = db().users.find_one({"email": email})
    sent = bool(user and user.get("active", True) and email_code(request, user, codes.KIND_RESET))
    return JsonResponse({"ok": True, "sent": sent, **code_state(user, codes.KIND_RESET)})


@csrf_exempt
@db_errors
def resend(request):
    """Send again, whichever code this address is waiting on."""
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    if not emailjs.configured():
        return JsonResponse({"error": "Email is not set up on this server yet."}, status=503)
    if rate_limited(request, 5, 60):
        return JsonResponse({"error": "Too many attempts. Wait a minute and try again."}, status=429)
    email = str(body_json(request).get("email", "")).strip().lower()[:254]
    user = db().users.find_one({"email": email})
    if user:
        kind = codes.KIND_VERIFY if not user.get("verified", True) else codes.KIND_RESET
        sent = email_code(request, user, kind) if user.get("active", True) else False
        owner = user
    else:
        # A signup still held as a pending code: the address exists, the account
        # does not, and the code has to be mailed from what that record remembers.
        doc = held_signup(email)
        owner = waiting(email, (doc or {}).get("held", {}).get("name", ""))
        kind = codes.KIND_VERIFY
        sent = bool(doc) and email_code(request, owner, kind)
    return JsonResponse({"ok": True, "sent": sent, **code_state(owner, kind)})


@csrf_exempt
@db_errors
def verify_email(request):
    """Turn a held signup into an account once the code proves the address is theirs.
    Accounts made before this change already have a row, so for them this only
    switches the flag on."""
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    if rate_limited(request):
        return JsonResponse({"error": "Too many attempts. Wait a minute and try again."}, status=429)
    data = body_json(request)
    email = str(data.get("email", "")).strip().lower()[:254]
    user = db().users.find_one({"email": email})
    doc = None
    if user:
        owner = user
        if not user.get("active", True):
            return JsonResponse({"error": "Wrong email or code."}, status=401)
    else:
        doc = held_signup(email)
        if not doc:
            log_event("verify", email, client_ip(request), ok=False)
            return JsonResponse({"error": "Wrong email or code."}, status=401)
        owner = waiting(email)
    ok, msg = codes.check(owner, codes.KIND_VERIFY, data.get("code"))
    if not ok:
        log_event("verify", email, client_ip(request), ok=False)
        return JsonResponse({"error": msg}, status=401)
    if user:
        db().users.update_one({"_id": user["_id"]}, {"$set": {"verified": True}})
        user["verified"] = True
    else:
        # The code is spent and correct, so this is where the account first exists.
        user = {
            "name": doc["held"].get("name") or "there",
            "email": email,
            "password": doc["held"]["password"],  # already hashed, at signup time
            "created": now(),
            "last_login": None,
            "logins": 0,
            "active": True,
            "verified": True,
        }
        try:
            user["_id"] = db().users.insert_one(user).inserted_id
        except DuplicateKeyError:
            return JsonResponse({"error": "An account with this email already exists."}, status=409)
    res = JsonResponse({"user": public(user), "email": email})
    start_session(request, res, user)
    log_event("verify", email, client_ip(request))
    return res


@csrf_exempt
@db_errors
def reset_password(request):
    """Set a new password with a live reset code. Every older session is dropped,
    because a reset is also the way out of a hijacked account."""
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    if rate_limited(request):
        return JsonResponse({"error": "Too many attempts. Wait a minute and try again."}, status=429)
    data = body_json(request)
    email = str(data.get("email", "")).strip().lower()[:254]
    password = str(data.get("password", ""))
    if not 8 <= len(password) <= 128:
        return JsonResponse({"error": "Password must be at least 8 characters."}, status=400)
    user = db().users.find_one({"email": email})
    if not user or not user.get("active", True):
        return JsonResponse({"error": "Wrong email or code."}, status=401)
    ok, msg = codes.check(user, codes.KIND_RESET, data.get("code"))
    if not ok:
        log_event("reset", email, client_ip(request), ok=False)
        return JsonResponse({"error": msg}, status=401)
    db().users.update_one(
        {"_id": user["_id"]},
        {"$set": {"password": make_password(password), "verified": True}},
    )
    db().sessions.delete_many({"user_id": user["_id"]})
    user["verified"] = True
    res = JsonResponse({"user": public(user)})
    start_session(request, res, user)
    log_event("reset", email, client_ip(request))
    return res


# ---------- Deck sync: one flashcard set per account ----------
DECK_MAX_CARDS = 3000
DECK_MAX_BYTES = 2_000_000
DECK_MAX_TEXT = 20_000
# Largest timestamp MongoDB and JS Date both agree on (year 275760).
DECK_MAX_TS = 8.64e15


def clean_value(v):
    """Bound the payload and drop keys MongoDB refuses to store (leading $ or an
    embedded dot), which would otherwise fail the whole write."""
    if isinstance(v, str):
        return v[:DECK_MAX_TEXT]
    if v is None or isinstance(v, (bool, int, float)):
        return v
    if isinstance(v, list):
        return [clean_value(x) for x in v[:500]]
    if isinstance(v, dict):
        return {
            str(k): clean_value(x)
            for k, x in v.items()
            if not str(k).startswith("$") and "." not in str(k)
        }
    return str(v)[:DECK_MAX_TEXT]


def clean_deck(payload):
    """Returns (cards, deleted, error) for a PUT body."""
    raw_cards = payload.get("cards") or []
    if not isinstance(raw_cards, list):
        return None, None, "cards must be a list"
    if len(raw_cards) > DECK_MAX_CARDS:
        return None, None, f"too many cards (max {DECK_MAX_CARDS})"
    cards, seen = [], set()
    for c in raw_cards:
        if not isinstance(c, dict):
            return None, None, "every card must be an object"
        cid = str(c.get("id", ""))[:64]
        if not cid or cid in seen:
            return None, None, "every card needs its own id"
        seen.add(cid)
        cards.append(clean_value(c))
    raw_deleted = payload.get("deleted") or {}
    if not isinstance(raw_deleted, dict):
        return None, None, "deleted must be an object"
    deleted = {}
    for k, v in list(raw_deleted.items())[:DECK_MAX_CARDS]:
        cid = str(k)[:64]
        if not cid or cid.startswith("$") or "." in cid:
            continue
        try:
            deleted[cid] = min(max(float(v), 0), DECK_MAX_TS)
        except (TypeError, ValueError):
            continue
    return cards, deleted, None


@csrf_exempt
@db_errors
def deck(request):
    """GET loads the signed-in account's deck on any device; PUT saves it.
    The owner comes from the session cookie, never from the request body."""
    user = current_user(request)
    if not user or not user.get("active", True):
        return JsonResponse({"error": "Not logged in"}, status=401)
    oid = user["_id"]

    if request.method == "GET":
        d = db().decks.find_one({"user_id": oid}) or {}
        return JsonResponse(
            {
                "cards": d.get("cards", []),
                "deleted": d.get("deleted", {}),
                "updated": d.get("updated"),
            }
        )
    if request.method not in ("PUT", "POST"):
        return JsonResponse({"error": "Method not allowed"}, status=405)
    if len(request.body) > DECK_MAX_BYTES:
        return JsonResponse({"error": "Deck is too large to save."}, status=413)
    cards, deleted, err = clean_deck(body_json(request))
    if err:
        return JsonResponse({"error": err}, status=400)
    saved = now()
    db().decks.update_one(
        {"user_id": oid},
        {"$set": {"cards": cards, "deleted": deleted, "updated": saved}},
        upsert=True,
    )
    return JsonResponse({"ok": True, "updated": saved})

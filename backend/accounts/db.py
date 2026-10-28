"""MongoDB access for accounts. Collections: users, sessions, events, decks, codes."""
from datetime import datetime, timezone

from django.conf import settings
from pymongo import ASCENDING, MongoClient

_client = None
_ready = False


def db():
    global _client, _ready
    if _client is None:
        _client = MongoClient(settings.MONGODB_URI, serverSelectionTimeoutMS=3000)
    d = _client[settings.MONGODB_DB]
    if not _ready:
        d.users.create_index([("email", ASCENDING)], unique=True)
        d.sessions.create_index([("token", ASCENDING)], unique=True)
        # MongoDB deletes expired sessions automatically.
        d.sessions.create_index("expires", expireAfterSeconds=0)
        d.events.create_index([("at", ASCENDING)])
        # One study deck per account, so a second device loads the same cards.
        d.decks.create_index([("user_id", ASCENDING)], unique=True)
        # One live code per account and purpose; MongoDB sweeps the expired ones.
        d.codes.create_index([("user_id", ASCENDING), ("kind", ASCENDING)], unique=True)
        d.codes.create_index("expires", expireAfterSeconds=0)
        _ready = True
    return d


def now():
    return datetime.now(timezone.utc)


def to_utc(dt):
    """Mongo returns naive datetimes, and aware minus naive raises TypeError."""
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def log_event(kind, email="", ip="", ok=True):
    """Security log shown on the admin dashboard."""
    try:
        db().events.insert_one({"kind": kind, "email": email, "ip": ip, "ok": ok, "at": now()})
    except Exception:
        pass

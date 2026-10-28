"""One-time 6-digit codes: prove an email is live before a new account exists, or
prove you own it before a password can be changed. Only a hash is stored, so a
leaked database does not hand out accounts."""

import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password

from .db import db, now, to_utc

MAX_ATTEMPTS = 3

KIND_VERIFY = "verify"
KIND_RESET = "reset"


def pending(user, kind):
    return db().codes.find_one({"user_id": user["_id"], "kind": kind})


def drop(user, kind):
    """Forget a code we no longer need, or one whose email never arrived."""
    db().codes.delete_many({"user_id": user["_id"], "kind": kind})


def rehold(user, kind, held):
    """Point the live code at the details just typed, without mailing anything."""
    db().codes.update_one({"user_id": user["_id"], "kind": kind}, {"$set": {"held": held}})


def hold(user, kind, held):
    """Keep a pending signup with no code in front of it.

    A signup that has not been confirmed owns no row in `users` (that is the whole
    point of verifying first), so if the email never reached the inbox the name and
    hashed password have to survive somewhere. They live here, and the next press of
    "Send a new code" picks them up instead of asking for the details all over again.
    """
    drop(user, kind)
    db().codes.insert_one(
        {
            "user_id": user["_id"],
            "kind": kind,
            "held": held,
            "attempts": 0,
            "created": now(),
            "expires": now() + timedelta(minutes=settings.CODE_TTL_MINUTES),
        }
    )


def can_send(user, kind):
    doc = pending(user, kind)
    # A record with no hash is a held signup, not a live code, so it never holds
    # anything back; neither does one a user could not type even if it arrived.
    if not doc or not doc.get("hash") or to_utc(doc["expires"]) <= now():
        return True
    return (now() - to_utc(doc["created"])).total_seconds() >= settings.CODE_COOLDOWN_SECONDS


def issue(user, kind, held=None):
    """Replace any live code and hand back the plain one to be emailed."""
    code = f"{secrets.randbelow(1_000_000):06d}"
    if held is None:
        held = (pending(user, kind) or {}).get("held")
    # The (user_id, kind) index is unique, so a resend removes the old code first.
    drop(user, kind)
    doc = {
        "user_id": user["_id"],
        "kind": kind,
        # PBKDF2 rather than a plain hash: the code space is only 10^6, so an
        # offline guess has to be made expensive. The attempt cap does the rest.
        "hash": make_password(code),
        "attempts": 0,
        "created": now(),
        "expires": now() + timedelta(minutes=settings.CODE_TTL_MINUTES),
    }
    if held is not None:
        doc["held"] = held
    db().codes.insert_one(doc)
    return code


def spend(doc):
    """A code is no longer usable. A finished account's record can go; a signup that
    is still waiting keeps its details, so the next press of "Send a new code" mails
    the account the person already described instead of stranding them."""
    if doc.get("held"):
        # The window is re-armed on purpose: MongoDB sweeps any record whose
        # deadline has passed, and this one still holds somebody's unfinished signup.
        db().codes.update_one(
            {"_id": doc["_id"]},
            {
                "$unset": {"hash": ""},
                "$set": {
                    "attempts": 0,
                    "expires": now() + timedelta(minutes=settings.CODE_TTL_MINUTES),
                },
            },
        )
    else:
        db().codes.delete_one({"_id": doc["_id"]})


def check(user, kind, code):
    """Returns (ok, message). Expired, over-limit and correct codes all stop working."""
    doc = pending(user, kind)
    if not doc or not doc.get("hash"):
        return False, "Request a new code first."
    if to_utc(doc["expires"]) < now():
        spend(doc)
        return False, "That code expired. Request a new one."
    if doc.get("attempts", 0) >= MAX_ATTEMPTS:
        spend(doc)
        return False, "Too many wrong tries. Request a new code."
    given = str(code or "").strip()
    if not (len(given) == 6 and given.isdigit() and check_password(given, doc["hash"])):
        db().codes.update_one({"_id": doc["_id"]}, {"$inc": {"attempts": 1}})
        left = MAX_ATTEMPTS - doc.get("attempts", 0) - 1
        return False, f"Wrong code. {left} {'try' if left == 1 else 'tries'} left."
    db().codes.delete_one({"_id": doc["_id"]})
    return True, ""

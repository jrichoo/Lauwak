"""Admin dashboard API. Only emails in LAUWAK_ADMIN_EMAILS can use it."""
import json
from datetime import timedelta
from functools import wraps

from bson import ObjectId
from bson.errors import InvalidId
from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from .db import db, log_event, now
from .views import client_ip, current_user, db_errors


def admin_only(view):
    @wraps(view)
    def wrapper(request, *a, **kw):
        user = current_user(request)
        if not user:
            return JsonResponse({"error": "Not logged in"}, status=401)
        if user["email"] not in settings.ADMIN_EMAILS:
            return JsonResponse({"error": "Admins only"}, status=403)
        request.admin = user
        return view(request, *a, **kw)

    return db_errors(wrapper)


def iso(d):
    return d.isoformat() if d else None


@admin_only
def overview(request):
    d = db()
    t = now()
    day, week = t - timedelta(days=1), t - timedelta(days=7)
    # Sign-ups per day for the last 14 days.
    start = (t - timedelta(days=13)).replace(hour=0, minute=0, second=0, microsecond=0)
    per_day = {
        r["_id"]: r["n"]
        for r in d.users.aggregate(
            [
                {"$match": {"created": {"$gte": start}}},
                {"$group": {"_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$created"}}, "n": {"$sum": 1}}},
            ]
        )
    }
    days = [(start + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(14)]
    return JsonResponse(
        {
            "users": d.users.count_documents({}),
            "new_7d": d.users.count_documents({"created": {"$gte": week}}),
            "active_24h": d.users.count_documents({"last_login": {"$gte": day}}),
            "sessions": d.sessions.count_documents({"expires": {"$gt": t}}),
            "failed_24h": d.events.count_documents({"ok": False, "at": {"$gte": day}}),
            "signups": [{"day": k, "n": per_day.get(k, 0)} for k in days],
        }
    )


@admin_only
def users(request):
    q = request.GET.get("q", "").strip().lower()[:100]
    filt = {}
    if q:
        import re

        rx = {"$regex": re.escape(q), "$options": "i"}
        filt = {"$or": [{"email": rx}, {"name": rx}]}
    rows = db().users.find(filt, {"password": 0}).sort("created", -1).limit(200)
    return JsonResponse(
        {
            "users": [
                {
                    "id": str(u["_id"]),
                    "name": u["name"],
                    "email": u["email"],
                    "created": iso(u.get("created")),
                    "last_login": iso(u.get("last_login")),
                    "logins": u.get("logins", 0),
                    "active": u.get("active", True),
                    "admin": u["email"] in settings.ADMIN_EMAILS,
                }
                for u in rows
            ]
        }
    )


@admin_only
def events(request):
    rows = db().events.find({}).sort("at", -1).limit(50)
    return JsonResponse(
        {"events": [{"kind": e["kind"], "email": e["email"], "ip": e["ip"], "ok": e["ok"], "at": iso(e["at"])} for e in rows]}
    )


@csrf_exempt
@admin_only
def user_action(request, user_id):
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    try:
        oid = ObjectId(user_id)
    except InvalidId:
        return JsonResponse({"error": "Bad user id"}, status=400)
    if oid == request.admin["_id"]:
        return JsonResponse({"error": "You can't change your own account here."}, status=400)
    try:
        action = json.loads(request.body or b"{}").get("action")
    except ValueError:
        action = None
    d = db()
    target = d.users.find_one({"_id": oid})
    if not target:
        return JsonResponse({"error": "User not found"}, status=404)
    if action in ("disable", "enable"):
        d.users.update_one({"_id": oid}, {"$set": {"active": action == "enable"}})
        if action == "disable":
            d.sessions.delete_many({"user_id": oid})
    elif action == "logout":
        d.sessions.delete_many({"user_id": oid})
    elif action == "delete":
        d.sessions.delete_many({"user_id": oid})
        d.decks.delete_many({"user_id": oid})
        d.users.delete_one({"_id": oid})
    else:
        return JsonResponse({"error": "Unknown action"}, status=400)
    log_event("admin:" + action, target["email"], client_ip(request))
    return JsonResponse({"ok": True})

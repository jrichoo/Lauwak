"""Run with: %LOCALAPPDATA%\\Lauwak\\.venv\\Scripts\\python backend/manage.py test accounts
Uses a separate MongoDB database (lauwak_test) that is dropped afterwards."""
import json
from contextlib import contextmanager
from datetime import timedelta
from unittest import mock

from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.test import SimpleTestCase, override_settings

from . import db as dbmod
from . import emailjs
from . import views
from .db import now

# Email verification is only switched on once EmailJS is configured, and the
# project's real .env must never decide that for a test run.
EMAIL_OFF = {
    "EMAILJS_PUBLIC_KEY": "",
    "EMAILJS_PRIVATE_KEY": "",
    "EMAILJS_SERVICE_ID": "",
    "EMAILJS_TEMPLATE_ID": "",
}
EMAIL_ON = {"EMAILJS_PUBLIC_KEY": "pub", "EMAILJS_SERVICE_ID": "svc", "EMAILJS_TEMPLATE_ID": "tpl"}


@override_settings(MONGODB_DB="lauwak_test", ADMIN_EMAILS=["boss@test.com"], **EMAIL_OFF)
class AuthTests(SimpleTestCase):
    def setUp(self):
        dbmod._ready = False
        views._hits.clear()
        self.d = dbmod.db()
        for c in ("users", "sessions", "events", "decks", "codes"):
            self.d[c].delete_many({})

    @contextmanager
    def email(self, ok=True):
        """Pretend to be EmailJS. Yields a list that collects every code that was
        "mailed", which is exactly what a user reads off their inbox."""
        mailed = []

        def fake_send(to_email, name, code, subject):
            mailed.append((to_email, code, subject))
            return ok, ""

        with override_settings(**EMAIL_ON), mock.patch.object(
            views.emailjs, "send_code", side_effect=fake_send
        ):
            yield mailed

    @classmethod
    def tearDownClass(cls):
        dbmod._client.drop_database("lauwak_test")
        super().tearDownClass()

    def post(self, path, data, client=None):
        return (client or self.client).post(path, json.dumps(data), content_type="application/json")

    def test_signup_login_logout_me(self):
        r = self.post("/api/auth/signup/", {"name": "Maria Santos", "email": "Maria@Test.com", "password": "short"})
        self.assertEqual(r.status_code, 400)
        r = self.post("/api/auth/signup/", {"name": "Maria Santos", "email": "Maria@Test.com", "password": "password123"})
        self.assertEqual(r.status_code, 201)
        self.assertTrue(r.cookies[settings.COOKIE_NAME]["httponly"])
        self.assertEqual(self.client.get("/api/auth/me/").json()["user"]["email"], "maria@test.com")
        # Password stored hashed, never plain.
        u = self.d.users.find_one({"email": "maria@test.com"})
        self.assertTrue(u["password"].startswith("pbkdf2_sha256$"))
        self.assertEqual(self.post("/api/auth/signup/", {"name": "X", "email": "maria@test.com", "password": "password123"}).status_code, 409)
        self.post("/api/auth/logout/", {})
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 401)
        self.assertEqual(self.post("/api/auth/login/", {"email": "maria@test.com", "password": "wrongpass1"}).status_code, 401)
        self.assertEqual(self.post("/api/auth/login/", {"email": "MARIA@test.com", "password": "password123"}).status_code, 200)
        self.assertEqual(self.client.get("/api/auth/me/").json()["user"]["name"], "Maria Santos")

    def test_admin_dashboard(self):
        self.post("/api/auth/signup/", {"name": "Juan", "email": "juan@test.com", "password": "password123"})
        self.assertEqual(self.client.get("/api/admin/overview/").status_code, 403)
        juan = self.d.users.find_one({"email": "juan@test.com"})
        boss = self.client_class()
        self.post("/api/auth/signup/", {"name": "Boss", "email": "boss@test.com", "password": "password123"}, boss)
        o = boss.get("/api/admin/overview/").json()
        self.assertEqual(o["users"], 2)
        self.assertEqual(len(o["signups"]), 14)
        self.assertEqual(len(boss.get("/api/admin/users/?q=juan").json()["users"]), 1)
        r = self.post(f"/api/admin/users/{juan['_id']}/", {"action": "disable"}, boss)
        self.assertEqual(r.status_code, 200)
        # Disabling signs the user out and blocks login.
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 401)
        self.assertEqual(self.post("/api/auth/login/", {"email": "juan@test.com", "password": "password123"}).status_code, 401)
        self.assertTrue(boss.get("/api/admin/events/").json()["events"])
        self.post(f"/api/admin/users/{juan['_id']}/", {"action": "delete"}, boss)
        self.assertEqual(boss.get("/api/admin/overview/").json()["users"], 1)

    def signup_as(self, name, email, client=None):
        return self.post(
            "/api/auth/signup/",
            {"name": name, "email": email, "password": "password123"},
            client,
        )

    def test_deck_needs_login(self):
        self.assertEqual(self.client.get("/api/deck/").status_code, 401)
        self.assertEqual(self.post("/api/deck/", {"cards": []}).status_code, 401)

    def test_deck_round_trip(self):
        self.signup_as("Maria", "maria@test.com")
        cards = [{"id": "1", "term": "Kumbi", "definition": "Grandmother", "mastery": 2, "updatedAt": 1_700_000_000_000}]
        self.assertEqual(self.post("/api/deck/", {"cards": cards, "deleted": {"9": 1_700_000_000_000}}).status_code, 200)
        d = self.client.get("/api/deck/").json()
        self.assertEqual(d["cards"], cards)
        self.assertEqual(d["deleted"], {"9": 1_700_000_000_000})
        self.assertTrue(d["updated"])

    def test_deck_rejects_bad_payloads(self):
        self.signup_as("Maria", "maria@test.com")
        for body in ({"cards": "nope"}, {"cards": [{"id": "1"}, {"id": "1"}]}, {"cards": [{"term": "no id"}]}):
            self.assertEqual(self.post("/api/deck/", body).status_code, 400, body)

    def test_deck_drops_keys_mongodb_refuses(self):
        self.signup_as("Maria", "maria@test.com")
        card = {"id": "1", "term": "ok", "$where": "evil", "a.b": "evil", "tags": [{"$gt": 1}]}
        self.assertEqual(self.post("/api/deck/", {"cards": [card], "deleted": {"2": "abc", "3": 1_700_000_000_000}}).status_code, 200)
        saved = self.client.get("/api/deck/").json()
        self.assertEqual(saved["cards"][0]["term"], "ok")
        for k in ("$where", "a.b"):
            self.assertNotIn(k, saved["cards"][0])
        self.assertEqual(saved["deleted"], {"3": 1_700_000_000_000})

    def test_deck_is_scoped_to_the_account(self):
        maria, juan = self.client_class(), self.client_class()
        self.signup_as("Maria", "maria@test.com", maria)
        self.signup_as("Juan", "juan@test.com", juan)
        self.post("/api/deck/", {"cards": [{"id": "1", "term": "A"}]}, maria)
        self.assertEqual(juan.get("/api/deck/").json()["cards"], [])
        self.post("/api/deck/", {"cards": [{"id": "2", "term": "B"}]}, juan)
        self.assertEqual([c["id"] for c in maria.get("/api/deck/").json()["cards"]], ["1"])

    def test_deck_rejects_oversized_body(self):
        self.signup_as("Maria", "maria@test.com")
        self.assertEqual(self.post("/api/deck/", {"cards": [{"id": "1", "term": "x" * 2_100_000}]}).status_code, 413)

    # ---------- email verification ----------
    def test_unconfigured_email_means_no_verification(self):
        r = self.signup_as("Maria", "maria@test.com")
        self.assertEqual(r.status_code, 201)
        self.assertFalse(r.json()["verify_required"])
        self.assertIn(settings.COOKIE_NAME, r.cookies)
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 200)

    def test_signup_waits_for_a_code(self):
        with self.email() as mailed:
            r = self.signup_as("Maria", "maria@test.com")
            self.assertEqual(r.status_code, 201)
            self.assertTrue(r.json()["verify_required"])
            self.assertTrue(r.json()["sent"])
            self.assertEqual(r.json()["email"], "maria@test.com")
            self.assertNotIn(settings.COOKIE_NAME, r.cookies)
            self.assertEqual(mailed[0][0], "maria@test.com")
            # There is no account at all yet, only a code that remembers one.
            self.assertIsNone(self.d.users.find_one({"email": "maria@test.com"}))
            self.assertEqual(self.client.get("/api/auth/me/").status_code, 401)
            # A correct password is not enough until the address is proven.
            blocked = self.post("/api/auth/login/", {"email": "maria@test.com", "password": "password123"})
            self.assertEqual(blocked.status_code, 403)
            self.assertTrue(blocked.json()["unverified"])
            self.assertEqual(self.post("/api/auth/verify/", {"email": "maria@test.com", "code": "000000"}).status_code, 401)
            ok = self.post("/api/auth/verify/", {"email": "maria@test.com", "code": mailed[0][1]})
            self.assertEqual(ok.status_code, 200)
            self.assertEqual(ok.json()["user"]["email"], "maria@test.com")
            self.assertEqual(self.client.get("/api/auth/me/").status_code, 200)
            self.assertEqual(self.d.codes.count_documents({}), 0)
            # The account is made from what the signup typed, password still hashed.
            u = self.d.users.find_one({"email": "maria@test.com"})
            self.assertEqual(u["name"], "Maria")
            self.assertTrue(u["password"].startswith("pbkdf2_sha256$"))
            self.assertNotEqual(u["password"], "password123")
            self.assertTrue(u["verified"])
            # Once verified, ordinary login takes over.
            fresh = self.client_class()
            self.assertEqual(self.post("/api/auth/login/", {"email": "maria@test.com", "password": "password123"}, fresh).status_code, 200)

    def test_an_abandoned_signup_leaves_no_account(self):
        with self.email() as mailed:
            self.signup_as("Maria", "maria@test.com")
            self.assertEqual(self.d.users.count_documents({}), 0)
            # Signing up again with the same address is a fresh start rather than
            # "already exists", and the code already on its way still belongs to it.
            r = self.post(
                "/api/auth/signup/", {"name": "Maria Santos", "email": "maria@test.com", "password": "another-pass-1"}
            )
            self.assertEqual(r.status_code, 201)
            self.assertTrue(r.json()["sent"])
            self.assertEqual(len(mailed), 1)
            # The details from this second attempt are the ones waiting to become an
            # account, so the first password no longer opens the code pane.
            self.assertEqual(self.post("/api/auth/login/", {"email": "maria@test.com", "password": "password123"}).status_code, 401)
            ok = self.post("/api/auth/verify/", {"email": "maria@test.com", "code": mailed[0][1]})
            self.assertEqual(ok.status_code, 200)
            self.assertEqual(ok.json()["user"]["name"], "Maria Santos")
        self.assertEqual(self.post("/api/auth/login/", {"email": "maria@test.com", "password": "another-pass-1"}).status_code, 200)

    def test_a_signed_up_password_opens_the_code_pane_not_the_app(self):
        with self.email():
            self.signup_as("Maria", "maria@test.com")
        # The person who closed the tab can come back through log in, because only
        # they hold the password they picked.
        r = self.post("/api/auth/login/", {"email": "maria@test.com", "password": "password123"})
        self.assertEqual(r.status_code, 403)
        self.assertTrue(r.json()["unverified"])
        self.assertNotIn(settings.COOKIE_NAME, r.cookies)
        self.assertEqual(self.post("/api/auth/login/", {"email": "maria@test.com", "password": "guessingpass1"}).status_code, 401)
        self.assertEqual(self.d.users.count_documents({}), 0)

    def test_wrong_codes_are_counted(self):
        with self.email() as mailed:
            self.signup_as("Maria", "maria@test.com")
            code = mailed[0][1]
            for want in ("2 tries left", "1 try left", "0 tries left"):
                r = self.post("/api/auth/verify/", {"email": "maria@test.com", "code": "123456"})
                self.assertEqual(r.status_code, 401)
                self.assertIn(want, r.json()["error"])
            # The cap burns the challenge, so even the right code is dead now.
            r = self.post("/api/auth/verify/", {"email": "maria@test.com", "code": "123456"})
            self.assertEqual(r.status_code, 401)
            r = self.post("/api/auth/verify/", {"email": "maria@test.com", "code": code})
            self.assertEqual(r.status_code, 401)
            self.assertEqual(self.d.codes.count_documents({"hash": {"$exists": True}}), 0)
            self.assertEqual(self.d.users.count_documents({}), 0)
            # ...and the waiting signup survives its own burnt code, so resend works.
            # (The limiter is shared by every endpoint on one IP, and the wrong tries
            # above have used this minute's allowance.)
            views._hits.clear()
            self.assertTrue(self.post("/api/auth/resend/", {"email": "maria@test.com"}).json()["sent"])
            self.assertEqual(
                self.post("/api/auth/verify/", {"email": "maria@test.com", "code": mailed[-1][1]}).status_code, 200
            )

    def test_expired_code_is_rejected(self):
        with self.email() as mailed:
            self.signup_as("Maria", "maria@test.com")
            self.d.codes.update_one(
                {"user_id": "maria@test.com"}, {"$set": {"expires": now() - timedelta(minutes=1)}}
            )
            r = self.post("/api/auth/verify/", {"email": "maria@test.com", "code": mailed[0][1]})
            self.assertEqual(r.status_code, 401)
            self.assertIn("expired", r.json()["error"])
            # No account was made, and the code is gone -- but the signup it was
            # waiting on is still held, so a resend can pick it up.
            self.assertEqual(self.d.users.count_documents({}), 0)
            self.assertEqual(self.d.codes.count_documents({"hash": {"$exists": True}}), 0)
            self.assertTrue(self.post("/api/auth/resend/", {"email": "maria@test.com"}).json()["sent"])
            self.assertEqual(
                self.post("/api/auth/verify/", {"email": "maria@test.com", "code": mailed[-1][1]}).status_code, 200
            )

    def test_cooldown_holds_a_code_that_was_delivered(self):
        with self.email() as mailed:
            self.signup_as("Maria", "maria@test.com")
            r = self.post("/api/auth/resend/", {"email": "maria@test.com"})
            self.assertEqual(r.status_code, 200)
            self.assertTrue(r.json()["sent"])
            self.assertEqual(len(mailed), 1)
            # The original code is still the one that works.
            self.assertEqual(self.post("/api/auth/verify/", {"email": "maria@test.com", "code": mailed[0][1]}).status_code, 200)

    def test_a_failed_send_does_not_start_the_cooldown(self):
        with self.email(ok=False) as mailed:
            r = self.signup_as("Maria", "maria@test.com")
            self.assertTrue(r.json()["verify_required"])
            self.assertFalse(r.json()["sent"])
            self.assertEqual(self.d.users.count_documents({}), 0)
            # Nothing is live, so nothing holds the next attempt back.
            self.assertEqual(self.d.codes.count_documents({"hash": {"$exists": True}}), 0)
            self.assertEqual(r.json()["resend_in"], 0)
        with self.email() as mailed:
            self.assertTrue(self.post("/api/auth/resend/", {"email": "maria@test.com"}).json()["sent"])
            self.assertEqual(len(mailed), 1)
            self.assertEqual(self.post("/api/auth/verify/", {"email": "maria@test.com", "code": mailed[0][1]}).status_code, 200)

    # ---------- forgot password ----------
    def test_forgot_and_reset(self):
        self.signup_as("Maria", "maria@test.com")
        self.post("/api/auth/login/", {"email": "maria@test.com", "password": "password123"})
        with self.email() as mailed:
            self.assertEqual(self.post("/api/auth/forgot/", {"email": "maria@test.com"}).status_code, 200)
            self.assertTrue(mailed[0][2].startswith("Your Lauwak reset"))
            # A short password is refused without spending the code.
            self.assertEqual(
                self.post("/api/auth/reset/", {"email": "maria@test.com", "code": mailed[0][1], "password": "short"}).status_code,
                400,
            )
            r = self.post("/api/auth/reset/", {"email": "maria@test.com", "code": mailed[0][1], "password": "brand-new-pass"})
            self.assertEqual(r.status_code, 200)
            self.assertEqual(self.d.codes.count_documents({}), 0)
        self.assertEqual(self.post("/api/auth/login/", {"email": "maria@test.com", "password": "password123"}).status_code, 401)
        fresh = self.client_class()
        self.assertEqual(self.post("/api/auth/login/", {"email": "maria@test.com", "password": "brand-new-pass"}, fresh).status_code, 200)

    def test_reset_drops_every_older_session(self):
        other = self.client_class()
        with self.email() as mailed:
            self.signup_as("Maria", "maria@test.com", other)
            self.post("/api/auth/verify/", {"email": "maria@test.com", "code": mailed[0][1]}, other)
            self.assertEqual(other.get("/api/auth/me/").status_code, 200)
            self.post("/api/auth/forgot/", {"email": "maria@test.com"})
            # Verify spent the signup code, so the reset code is the one just mailed.
            self.assertEqual(
                self.post(
                    "/api/auth/reset/",
                    {"email": "maria@test.com", "code": mailed[-1][1], "password": "brand-new-pass"},
                ).status_code,
                200,
            )
            # The cookie the reset itself set is live; the signed-in device is not.
            self.assertEqual(self.client.get("/api/auth/me/").status_code, 200)
        self.assertEqual(other.get("/api/auth/me/").status_code, 401)
        self.assertTrue(self.d.users.find_one({"email": "maria@test.com"})["verified"])

    def test_forgot_leaks_nothing_about_the_address(self):
        with self.email() as mailed:
            r = self.post("/api/auth/forgot/", {"email": "nobody@test.com"})
            self.assertEqual(r.status_code, 200)
            self.assertFalse(r.json()["sent"])
            self.assertEqual(mailed, [])
            self.assertEqual(self.d.codes.count_documents({}), 0)
            same_shape = self.post("/api/auth/forgot/", {"email": "MARIA@test.com"})
            self.assertEqual(sorted(same_shape.json()), sorted(r.json()))

    def test_code_endpoints_need_email_to_be_configured(self):
        self.assertEqual(self.post("/api/auth/forgot/", {"email": "maria@test.com"}).status_code, 503)
        self.assertEqual(self.post("/api/auth/resend/", {"email": "maria@test.com"}).status_code, 503)
        self.assertEqual(self.post("/api/auth/reset/", {"email": "maria@test.com", "code": "123456", "password": "password123"}).status_code, 401)

    def test_code_methods_are_post_only(self):
        for path in ("/api/auth/forgot/", "/api/auth/resend/", "/api/auth/verify/", "/api/auth/reset/"):
            self.assertEqual(self.client.get(path).status_code, 405, path)

    def test_login_does_not_strand_an_account_when_email_goes_off(self):
        # An account made by the older build -- a row that never got its code, and
        # keys then removed from .env. The password still has to get in.
        self.d.users.insert_one(
            {
                "name": "Maria",
                "email": "maria@test.com",
                "password": make_password("password123"),
                "created": now(),
                "last_login": None,
                "logins": 0,
                "active": True,
                "verified": False,
            }
        )
        r = self.post("/api/auth/login/", {"email": "maria@test.com", "password": "password123"})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(self.d.users.find_one({"email": "maria@test.com"})["verified"])

    def test_a_signup_left_behind_by_that_change_still_verifies(self):
        # Same older row, but this install does have email: it must not be stuck,
        # and the code path is the one the login page offers.
        maria = self.d.users.insert_one(
            {
                "name": "Maria",
                "email": "maria@test.com",
                "password": make_password("password123"),
                "created": now(),
                "last_login": None,
                "logins": 0,
                "active": True,
                "verified": False,
            }
        ).inserted_id
        with self.email() as mailed:
            self.assertEqual(
                self.post("/api/auth/login/", {"email": "maria@test.com", "password": "password123"}).status_code, 403
            )
            self.assertTrue(self.post("/api/auth/resend/", {"email": "maria@test.com"}).json()["sent"])
            r = self.post("/api/auth/verify/", {"email": "maria@test.com", "code": mailed[0][1]})
            self.assertEqual(r.status_code, 200)
        # The row it had all along is switched on -- no second account was made.
        self.assertTrue(self.d.users.find_one({"_id": maria})["verified"])
        self.assertEqual(self.d.users.count_documents({}), 1)

    def test_answers_carry_the_countdown_numbers(self):
        full = settings.CODE_TTL_MINUTES * 60
        holder = views.waiting("maria@test.com")
        with self.email():
            r = self.signup_as("Maria", "maria@test.com").json()
            self.assertTrue(full - 30 <= r["expires_in"] <= full, r["expires_in"])
            self.assertTrue(50 <= r["resend_in"] <= settings.CODE_COOLDOWN_SECONDS, r["resend_in"])
            # A resend inside the cooldown reports the wait that is really left.
            r = self.post("/api/auth/resend/", {"email": "maria@test.com"}).json()
            self.assertTrue(0 <= r["resend_in"] <= settings.CODE_COOLDOWN_SECONDS)
            self.assertTrue(r["expires_in"] <= full)
            # An address with no live code gets the full window back.
            r = self.post("/api/auth/forgot/", {"email": "nobody@test.com"}).json()
            self.assertEqual(r["expires_in"], full)
            self.assertEqual(r["resend_in"], 0)
            # A live code past its own deadline reports itself as dead.
            self.d.codes.update_one(
                {"user_id": "maria@test.com"}, {"$set": {"expires": now() - timedelta(minutes=1)}}
            )
            self.assertEqual(
                views.code_state(holder, views.codes.KIND_VERIFY), {"expires_in": 0, "resend_in": 0}
            )
            # A signup held with no code in front of it has nothing to count down.
            self.d.codes.update_one({"user_id": "maria@test.com"}, {"$unset": {"hash": ""}})
            self.assertEqual(
                views.code_state(holder, views.codes.KIND_VERIFY), {"expires_in": 0, "resend_in": 0}
            )

    def test_an_expired_code_ends_the_cooldown_too(self):
        with self.email() as mailed:
            self.signup_as("Maria", "maria@test.com")
            self.d.codes.update_one(
                {"user_id": "maria@test.com"}, {"$set": {"expires": now() - timedelta(minutes=1)}}
            )
            r = self.post("/api/auth/resend/", {"email": "maria@test.com"}).json()
            self.assertTrue(r["sent"])
            self.assertEqual(len(mailed), 2)  # a real new code, not the dead one held back
            self.assertEqual(self.post("/api/auth/verify/", {"email": "maria@test.com", "code": mailed[1][1]}).status_code, 200)

    def test_emailjs_asks_like_a_browser(self):
        # Cloudflare answers EmailJS with "error code: 1010" to urllib's default
        # user agent, so this header is what makes a send possible at all.
        with override_settings(**EMAIL_ON), mock.patch("urllib.request.urlopen") as urlopen:
            urlopen.return_value.__enter__.return_value.read.return_value = b""
            ok, _ = emailjs.send_code("someone@test.com", "Someone", "123456", "subject")
        self.assertTrue(ok)
        self.assertIn("Mozilla", urlopen.call_args[0][0].get_header("User-agent"))

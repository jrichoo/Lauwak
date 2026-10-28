"""Sends the 6-digit code emails through EmailJS's REST API (no SDK, no new dependency)."""
import json
import threading
import time
import urllib.error
import urllib.request

from django.conf import settings

SEND_URL = "https://api.emailjs.com/api/v1.0/email/send"
TIMEOUT_SECONDS = 10
# EmailJS sits behind Cloudflare, which answers "error code: 1010" to the default
# urllib user agent, so the request has to look like it came from a browser.
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
)

# Every name a code template is commonly written with. Whichever one the dashboard
# template uses gets the digits; the rest are simply ignored by EmailJS.
CODE_NAMES = ("passcode", "code", "otp", "pin", "verification_code", "message")

# EmailJS allows one request per second per account, so sends queue up here rather
# than two signups hitting the API in the same instant and one of them failing.
_gate = threading.Lock()
_last_send = [0.0]


def configured():
    """False means verification is switched off for this install (see settings.py)."""
    return bool(
        settings.EMAILJS_PUBLIC_KEY and settings.EMAILJS_SERVICE_ID and settings.EMAILJS_TEMPLATE_ID
    )


def send_code(to_email, name, code, subject):
    """Returns (ok, error). EmailJS fills the template by matching these names to the
    {{braces}} written in the template's Content, so at least one spelling per value
    has to be the one the dashboard template actually uses."""
    body = {
        "service_id": settings.EMAILJS_SERVICE_ID,
        "template_id": settings.EMAILJS_TEMPLATE_ID,
        "user_id": settings.EMAILJS_PUBLIC_KEY,
        # The names go bare: braces belong in the template content, never in a key.
        "template_params": {
            "to_email": to_email,
            "email": to_email,
            "subject": subject,
            "name": name or "there",
            # The code is the one value a template can spell half a dozen ways, and a
            # send that comes back 200 with an empty body is invisible from this side.
            **dict.fromkeys(CODE_NAMES, code),
            "time": settings.CODE_TTL_MINUTES,
            "minutes": settings.CODE_TTL_MINUTES,
            "app_name": "Lauwak",
        },
    }
    if settings.EMAILJS_PRIVATE_KEY:
        body["accessToken"] = settings.EMAILJS_PRIVATE_KEY

    request = urllib.request.Request(
        SEND_URL,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
        method="POST",
    )
    with _gate:
        wait = 1.0 - (time.monotonic() - _last_send[0])
        if wait > 0:
            time.sleep(wait)
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                response.read()
        except urllib.error.HTTPError as e:
            # EmailJS's own message is kept out of the browser response, but the
            # server window needs it or a bad template ID is undebuggable.
            detail = e.read()[:200].decode("utf-8", "replace")
            if "non-browser" in detail:
                detail += "  -> switch it on at dashboard.emailjs.com/admin/account/security"
            print(f"[emailjs] HTTP {e.code}: {detail}")
            return False, "The email service rejected the request."
        except Exception as e:
            print(f"[emailjs] {e.__class__.__name__}: {e}")
            return False, "The email service could not be reached."
        finally:
            _last_send[0] = time.monotonic()
    return True, ""

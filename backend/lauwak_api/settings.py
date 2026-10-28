"""Django settings for the Lauwak auth API.

Users and sessions live in MongoDB (via PyMongo, see accounts/db.py).
Django's own SQL database is not used.
"""
import os
import secrets
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
# Shared .env lives in flashcard-quiz/ (one level above backend/).
load_dotenv(BASE_DIR.parent / ".env")

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY") or secrets.token_urlsafe(50)
DEBUG = os.environ.get("DJANGO_DEBUG", "0") == "1"
ALLOWED_HOSTS = ["127.0.0.1", "localhost"] + [
    h.strip() for h in os.environ.get("DJANGO_ALLOWED_HOSTS", "").split(",") if h.strip()
]

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.staticfiles",
    "corsheaders",
    "accounts",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

CORS_ALLOW_ALL_ORIGINS = True

ROOT_URLCONF = "lauwak_api.urls"
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {"context_processors": []},
    }
]
WSGI_APPLICATION = "lauwak_api.wsgi.application"

# No SQL database: everything is stored in MongoDB.
DATABASES = {}

# Strong password hashing (PBKDF2-SHA256, Django default).
PASSWORD_HASHERS = ["django.contrib.auth.hashers.PBKDF2PasswordHasher"]

MONGODB_URI = os.environ.get("MONGODB_URI", "mongodb://127.0.0.1:27017")
MONGODB_ATLAS_URI = os.environ.get("MONGODB_ATLAS_URI", "")
MONGODB_DB = os.environ.get("MONGODB_DB", "lauwak")
SESSION_DAYS = 30
COOKIE_NAME = "lauwak_sid"

# Comma-separated emails allowed to open the admin dashboard. Stored emails are
# lower-cased on signup, so the list is normalised the same way. No default: this
# address is the key to the dashboard, and a published file tells the world which
# mailbox to aim at.
ADMIN_EMAILS = [
    e.strip().lower()
    for e in os.environ.get("LAUWAK_ADMIN_EMAILS", "").split(",")
    if e.strip()
]


# Email verification and password reset send a 6-digit code through EmailJS's
# REST API. Every value here comes from the environment: a key with a copy in this
# file is a key in whatever repository this file ends up in. Leave them empty to
# switch verification off: signup then works the way it always did instead of
# locking every new account out.
EMAILJS_PUBLIC_KEY = os.environ.get("EMAILJS_PUBLIC_KEY", "")
EMAILJS_PRIVATE_KEY = os.environ.get("EMAILJS_PRIVATE_KEY", "")
EMAILJS_SERVICE_ID = os.environ.get("EMAILJS_SERVICE_ID", "")
EMAILJS_TEMPLATE_ID = os.environ.get("EMAILJS_TEMPLATE_ID", "")
CODE_TTL_MINUTES = 3
CODE_COOLDOWN_SECONDS = 60

STATIC_URL = "static/"
USE_TZ = True
TIME_ZONE = "UTC"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

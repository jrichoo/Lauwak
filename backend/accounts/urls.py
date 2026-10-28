from django.urls import path

from . import views

urlpatterns = [
    path("signup/", views.signup),
    path("login/", views.login),
    path("logout/", views.logout),
    path("me/", views.me),
    path("forgot/", views.forgot),
    path("resend/", views.resend),
    path("verify/", views.verify_email),
    path("reset/", views.reset_password),
]

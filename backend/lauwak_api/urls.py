from django.urls import include, path

from accounts import views

urlpatterns = [
    path("api/auth/", include("accounts.urls")),
    path("api/admin/", include("accounts.admin_urls")),
    path("api/deck/", views.deck),
]

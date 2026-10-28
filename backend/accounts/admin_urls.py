from django.urls import path
from . import admin_views as v

urlpatterns = [
    path("overview/", v.overview),
    path("users/", v.users),
    path("users/<str:user_id>/", v.user_action),
    path("events/", v.events),
]

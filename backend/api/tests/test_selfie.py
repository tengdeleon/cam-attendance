"""Tests for GET /attendance/{attendance_id}/selfie (selfie review endpoint).

Covers the seven cases from docs/plans/selfie-review.md test checklist:
200 success, 401 (missing / invalid token), 403 (not a teacher), 404 (no row),
409 (selfie purged), 502 (signed-URL generation failed).

Two mocking strategies:
- Service-path cases (200/404/409/502): override the current_teacher dependency to
  bypass auth, then monkeypatch the Supabase client + signed_url the service uses.
- Auth-path cases (401/403): leave the real dependency in place and monkeypatch
  verify_token / get_supabase inside app.deps so no network/JWKS call is made.
"""
import pytest
from fastapi.testclient import TestClient
from jose import JWTError

import app.deps as deps
from app.deps import current_teacher
from app.main import app
from app.services import attendance_service, storage_service

client = TestClient(app)
AUTH = {"Authorization": "Bearer good-token"}


class FakeQuery:
    """Chainable stub: every builder method returns self; execute() yields .data."""

    def __init__(self, data):
        self._data = data

    def select(self, *a, **k):
        return self

    def eq(self, *a, **k):
        return self

    def single(self, *a, **k):
        return self

    def execute(self):
        return type("Result", (), {"data": self._data})()


class FakeSupabase:
    def __init__(self, tables):
        self._tables = tables  # {table_name: data}

    def table(self, name):
        return FakeQuery(self._tables.get(name))


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


def _bypass_auth():
    app.dependency_overrides[current_teacher] = lambda: {
        "id": "t1",
        "person_id": "p1",
        "is_admin": False,
    }


# --- service path: auth bypassed -------------------------------------------------

def test_selfie_success(monkeypatch):
    _bypass_auth()
    monkeypatch.setattr(
        attendance_service, "get_supabase",
        lambda: FakeSupabase({"attendance": [{"id": "a1", "selfie_url": "2026/07/01/a1.jpg"}]}),
    )
    monkeypatch.setattr(storage_service, "signed_url", lambda path, ttl: "https://signed/url")

    r = client.get("/attendance/a1/selfie", headers=AUTH)

    assert r.status_code == 200
    assert r.json() == {"url": "https://signed/url", "expires_in": 60}


def test_selfie_not_found(monkeypatch):
    _bypass_auth()
    monkeypatch.setattr(attendance_service, "get_supabase", lambda: FakeSupabase({"attendance": []}))

    r = client.get("/attendance/missing/selfie", headers=AUTH)

    assert r.status_code == 404
    assert r.json()["detail"] == "Selfie not found"


def test_selfie_purged(monkeypatch):
    _bypass_auth()
    monkeypatch.setattr(
        attendance_service, "get_supabase",
        lambda: FakeSupabase({"attendance": [{"id": "a1", "selfie_url": ""}]}),
    )

    r = client.get("/attendance/a1/selfie", headers=AUTH)

    assert r.status_code == 409
    assert r.json()["detail"] == "Selfie for this record has been purged"


def test_selfie_signed_url_failure(monkeypatch):
    _bypass_auth()
    monkeypatch.setattr(
        attendance_service, "get_supabase",
        lambda: FakeSupabase({"attendance": [{"id": "a1", "selfie_url": "2026/07/01/a1.jpg"}]}),
    )
    monkeypatch.setattr(storage_service, "signed_url", lambda path, ttl: "")

    r = client.get("/attendance/a1/selfie", headers=AUTH)

    assert r.status_code == 502
    assert r.json()["detail"] == "Could not generate signed URL"


# --- auth path: real dependency runs --------------------------------------------

def test_selfie_missing_token():
    r = client.get("/attendance/a1/selfie")  # no Authorization header
    assert r.status_code == 401
    assert r.json()["detail"] == "Missing bearer token"


def test_selfie_invalid_token(monkeypatch):
    def _raise(token):
        raise JWTError("bad signature")

    monkeypatch.setattr(deps, "verify_token", _raise)

    r = client.get("/attendance/a1/selfie", headers={"Authorization": "Bearer bad"})

    assert r.status_code == 401
    assert r.json()["detail"] == "Invalid token"


def test_selfie_not_a_teacher(monkeypatch):
    monkeypatch.setattr(deps, "verify_token", lambda token: {"sub": "auth-user-1"})
    monkeypatch.setattr(deps, "get_supabase", lambda: FakeSupabase({"teacher_accounts": None}))

    r = client.get("/attendance/a1/selfie", headers=AUTH)

    assert r.status_code == 403
    assert r.json()["detail"] == "Not a teacher account"

"""Tests for POST /attendance idempotency (migration 0003 + endpoint guard).

Covers the two guarantees the idempotency key adds:
- A replay with a known key returns the ORIGINAL record and performs no second
  insert and no second selfie upload (double-tap / offline re-fire).
- A first-time request with a key stores that key on the inserted row.
- A request without a key still works (behaviour unchanged).

Mocking mirrors test_selfie.py: override current_teacher to bypass auth, then
monkeypatch the Supabase client + storage the service uses. The stub here is a
richer FakeSupabase that records inserts and supports the full query chain
(select/eq/gte/lt/order/limit/single/insert) that record_attendance walks.
"""
from fastapi.testclient import TestClient

from app.deps import current_teacher
from app.main import app
from app.services import attendance_service, storage_service

client = TestClient(app)
AUTH = {"Authorization": "Bearer good-token"}


class FakeQuery:
    """Chainable stub: builder methods return self; insert is recorded on the store."""

    def __init__(self, store, name):
        self._store = store
        self._name = name

    def select(self, *a, **k):
        return self

    def eq(self, *a, **k):
        return self

    def gte(self, *a, **k):
        return self

    def lt(self, *a, **k):
        return self

    def order(self, *a, **k):
        return self

    def limit(self, *a, **k):
        return self

    def single(self, *a, **k):
        return self

    def insert(self, row, *a, **k):
        self._store.inserts.append((self._name, row))
        return self

    def execute(self):
        return type("Result", (), {"data": self._store.tables.get(self._name)})()


class FakeSupabase:
    def __init__(self, tables):
        self.tables = tables  # {table_name: data (list) | dict (for .single())}
        self.inserts = []

    def table(self, name):
        return FakeQuery(self, name)


def _bypass_auth():
    app.dependency_overrides[current_teacher] = lambda: {
        "id": "t1",
        "person_id": "p1",
        "is_admin": False,
    }


def _clear():
    app.dependency_overrides.clear()


def test_replay_returns_original_and_does_not_insert(monkeypatch):
    """Same idempotency_key => original row, no duplicate insert, no re-upload."""
    _bypass_auth()
    existing = {
        "id": "a1",
        "person_id": "p1",
        "direction": "in",
        "logged_by": "t1",
        "server_time": "2026-07-14T01:00:00+00:00",
    }
    fake = FakeSupabase({"attendance": [existing]})
    monkeypatch.setattr(attendance_service, "get_supabase", lambda: fake)

    upload_calls = []
    monkeypatch.setattr(
        storage_service, "upload_selfie",
        lambda aid, content: upload_calls.append(aid) or "path",
    )

    try:
        r = client.post(
            "/attendance",
            data={"person_id": "p1", "direction": "in", "idempotency_key": "key-123"},
            files={"selfie": ("s.jpg", b"imagebytes", "image/jpeg")},
            headers=AUTH,
        )
    finally:
        _clear()

    assert r.status_code == 201
    assert r.json()["id"] == "a1"           # original record, not a new one
    assert fake.inserts == []               # no duplicate insert
    assert upload_calls == []               # selfie not re-uploaded (storage saved)


def test_new_checkin_stores_idempotency_key(monkeypatch):
    """First-time request with a key inserts one row carrying that key."""
    _bypass_auth()
    fake = FakeSupabase({
        "people": {"id": "p1", "is_active": True},   # .single() -> dict
        "attendance": [],                            # no prior key, none today, no prior day
        "v_daily_last_direction": [],
    })
    monkeypatch.setattr(attendance_service, "get_supabase", lambda: fake)
    monkeypatch.setattr(
        storage_service, "upload_selfie",
        lambda aid, content: f"2026/07/14/{aid}.jpg",
    )

    try:
        r = client.post(
            "/attendance",
            data={"person_id": "p1", "direction": "in", "idempotency_key": "key-xyz"},
            files={"selfie": ("s.jpg", b"imagebytes", "image/jpeg")},
            headers=AUTH,
        )
    finally:
        _clear()

    assert r.status_code == 201
    assert len(fake.inserts) == 1
    name, row = fake.inserts[0]
    assert name == "attendance"
    assert row["idempotency_key"] == "key-xyz"


def test_no_key_still_inserts(monkeypatch):
    """Backward compatibility: omitting the key inserts a row with a null key."""
    _bypass_auth()
    fake = FakeSupabase({
        "people": {"id": "p1", "is_active": True},
        "attendance": [],
        "v_daily_last_direction": [],
    })
    monkeypatch.setattr(attendance_service, "get_supabase", lambda: fake)
    monkeypatch.setattr(
        storage_service, "upload_selfie",
        lambda aid, content: f"2026/07/14/{aid}.jpg",
    )

    try:
        r = client.post(
            "/attendance",
            data={"person_id": "p1", "direction": "in"},
            files={"selfie": ("s.jpg", b"imagebytes", "image/jpeg")},
            headers=AUTH,
        )
    finally:
        _clear()

    assert r.status_code == 201
    assert len(fake.inserts) == 1
    _, row = fake.inserts[0]
    assert row["idempotency_key"] is None

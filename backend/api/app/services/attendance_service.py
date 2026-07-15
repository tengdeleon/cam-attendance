"""Attendance business logic: validation, insert, today's board, history."""
import uuid
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status

from app.db import get_supabase
from app.models.schemas import AttendanceIn
from app.services import storage_service

MANILA = ZoneInfo("Asia/Manila")


def manila_day_bounds(start: date, end: date) -> tuple[str, str]:
    """UTC ISO bounds covering Manila-local days [start, end] inclusive."""
    lo = datetime.combine(start, time.min, tzinfo=MANILA).astimezone(timezone.utc)
    hi = datetime.combine(end + timedelta(days=1), time.min, tzinfo=MANILA).astimezone(timezone.utc)
    return lo.isoformat(), hi.isoformat()


def _find_missed_checkout_days(sb, person_id: str, before_utc: str, today_mnl: date) -> list[str]:
    """Return Manila-local dates (YYYY-MM-DD) where person's last event was 'in',
    strictly before today_mnl. Uses caller-supplied date to avoid a second clock read
    that could straddle midnight and yield a different Manila date."""
    res = (
        sb.table("v_daily_last_direction")
        .select("local_day, last_direction")
        .eq("person_id", person_id)
        .eq("last_direction", "in")
        .lt("local_day", today_mnl.isoformat())
        .order("local_day", desc=False)
        .execute()
    )
    return [r["local_day"] for r in res.data or []]


def _find_by_idempotency_key(sb, key: str) -> dict | None:
    """Return the AttendanceOut-shaped fields of a prior row with this key, or None."""
    res = (
        sb.table("attendance")
        .select("id, person_id, direction, logged_by, server_time")
        .eq("idempotency_key", key)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def record_attendance(payload: AttendanceIn, selfie: bytes, teacher_id: str) -> dict:
    if not selfie:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Selfie is required")

    sb = get_supabase()

    # Idempotency short-circuit — runs before person validation, the R1/R2 duplicate-
    # state guard, and the selfie upload. A replay (double-tap or offline re-fire)
    # returns the original record instead of a duplicate insert or a spurious 409.
    if payload.idempotency_key:
        prior = _find_by_idempotency_key(sb, payload.idempotency_key)
        if prior:
            return {**prior, "warnings": []}

    person = sb.table("people").select("id,is_active").eq("id", payload.person_id).single().execute()
    if not person.data or not person.data["is_active"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown or inactive person")

    # R1 / R2 — duplicate-state guard
    today_mnl = datetime.now(MANILA).date()
    lo, hi = manila_day_bounds(today_mnl, today_mnl)
    existing = (
        sb.table("attendance")
        .select("id, direction")
        .eq("person_id", payload.person_id)
        .gte("server_time", lo)
        .lt("server_time", hi)
        .order("server_time", desc=True)
        .limit(1)
        .execute()
    )
    latest_today = existing.data[0] if existing.data else None

    if payload.direction == "in" and latest_today and latest_today["direction"] == "in":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={"detail": "Already checked in", "code": "already_checked_in"},
        )
    if payload.direction == "out" and (not latest_today or latest_today["direction"] == "out"):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={"detail": "Not checked in", "code": "not_checked_in"},
        )

    # R3 — missed-checkout warning detection (check-in path only)
    warnings: list[dict] = []
    if payload.direction == "in":
        prior = (
            sb.table("attendance")
            .select("id, direction, server_time")
            .eq("person_id", payload.person_id)
            .lt("server_time", lo)
            .order("server_time", desc=True)
            .limit(1)
            .execute()
        )
        if prior.data and prior.data[0]["direction"] == "in":
            missed = _find_missed_checkout_days(sb, payload.person_id, lo, today_mnl)
            warnings = [{"code": "missed_checkout", "date": d} for d in missed]

    attendance_id = str(uuid.uuid4())
    path = storage_service.upload_selfie(attendance_id, selfie)

    row = {
        "id": attendance_id,
        "person_id": payload.person_id,
        "direction": payload.direction,
        "selfie_url": path,
        "logged_by": teacher_id,
        "device_time": payload.device_time.isoformat() if payload.device_time else None,
        "server_time": datetime.now(timezone.utc).isoformat(),
        "sync_status": "synced",
        "idempotency_key": payload.idempotency_key,
    }
    try:
        sb.table("attendance").insert(row).execute()
    except Exception:
        # Concurrent-request race: the earlier short-circuit missed a request that
        # was in flight, and the partial unique index (0003) rejected this insert.
        # Recover by returning the row the winner wrote — never surface a 500.
        if payload.idempotency_key:
            prior = _find_by_idempotency_key(sb, payload.idempotency_key)
            if prior:
                return {**prior, "warnings": []}
        raise
    return {**row, "warnings": warnings}


def today_board() -> list[dict]:
    """Latest direction per person for the current Manila-local date."""
    sb = get_supabase()
    today_mnl = datetime.now(MANILA).date()
    lo, hi = manila_day_bounds(today_mnl, today_mnl)
    res = (
        sb.table("attendance")
        .select("id, person_id, direction, server_time, people(full_name, role)")
        .gte("server_time", lo)
        .lt("server_time", hi)
        .order("server_time", desc=True)
        .execute()
    )
    seen: dict[str, dict] = {}
    for r in res.data or []:
        pid = r["person_id"]
        if pid not in seen:
            seen[pid] = {
                "person_id": pid,
                "full_name": r["people"]["full_name"],
                "role": r["people"]["role"],
                "last_direction": r["direction"],
                "last_time": r["server_time"],
                "last_attendance_id": r["id"],
            }
    return list(seen.values())


def get_selfie_url(attendance_id: str) -> dict:
    """Return a short-lived signed URL for the selfie attached to one attendance record."""
    sb = get_supabase()
    res = sb.table("attendance").select("id, selfie_url").eq("id", attendance_id).execute()
    if not res.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Selfie not found")
    row = res.data[0]
    if not row.get("selfie_url"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Selfie for this record has been purged")
    url = storage_service.signed_url(row["selfie_url"], storage_service.SELFIE_URL_TTL)
    if not url:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Could not generate signed URL")
    return {"url": url, "expires_in": storage_service.SELFIE_URL_TTL}


def history(start: date, end: date) -> list[dict]:
    """Attendance rows for Manila-local days [start, end], newest first."""
    lo, hi = manila_day_bounds(start, end)
    sb = get_supabase()
    res = (
        sb.table("attendance")
        .select("id, person_id, direction, server_time, people(full_name, role)")
        .gte("server_time", lo)
        .lt("server_time", hi)
        .order("server_time", desc=True)
        .execute()
    )
    return [
        {
            "id": r["id"],
            "person_id": r["person_id"],
            "full_name": r["people"]["full_name"],
            "role": r["people"]["role"],
            "direction": r["direction"],
            "server_time": r["server_time"],
        }
        for r in res.data or []
    ]

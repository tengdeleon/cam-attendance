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


def record_attendance(payload: AttendanceIn, selfie: bytes, teacher_id: str) -> dict:
    if not selfie:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Selfie is required")

    sb = get_supabase()
    person = sb.table("people").select("id,is_active").eq("id", payload.person_id).single().execute()
    if not person.data or not person.data["is_active"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown or inactive person")

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
    }
    sb.table("attendance").insert(row).execute()
    return row


def today_board() -> list[dict]:
    """Latest direction per person for the current Manila-local date."""
    sb = get_supabase()
    today_mnl = datetime.now(MANILA).date()
    lo, hi = manila_day_bounds(today_mnl, today_mnl)
    res = (
        sb.table("attendance")
        .select("person_id, direction, server_time, people(full_name, role)")
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
            }
    return list(seen.values())


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

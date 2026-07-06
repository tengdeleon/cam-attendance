"""Attendance business logic: validation, insert, today's board."""
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.db import get_supabase
from app.models.schemas import AttendanceIn
from app.services import storage_service


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
    """Latest direction per person for the current UTC date."""
    sb = get_supabase()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    res = (
        sb.table("attendance")
        .select("person_id, direction, server_time, people(full_name, role)")
        .gte("server_time", f"{today}T00:00:00Z")
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

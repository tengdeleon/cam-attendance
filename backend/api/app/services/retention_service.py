"""Retention & erasure: purge old selfies; erase a person on request (RA 10173)."""
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status

from app.config import settings
from app.db import get_supabase


def erase_person(person_id: str) -> dict:
    """Permanently delete a person, their attendance rows, and all their selfies.

    Refuses (409) if the person is a teacher whose account logged other
    people's entries — those rows' logged_by would dangle. Deactivate instead,
    or reassign their logged entries first.
    """
    sb = get_supabase()

    person = sb.table("people").select("id").eq("id", person_id).execute()
    if not person.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown person")

    ta = sb.table("teacher_accounts").select("id").eq("person_id", person_id).execute()
    if ta.data:
        ta_id = ta.data[0]["id"]
        logged_others = (
            sb.table("attendance")
            .select("id", count="exact")
            .eq("logged_by", ta_id)
            .neq("person_id", person_id)
            .execute()
        )
        if (logged_others.count or 0) > 0:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "This teacher logged other people's attendance; their account "
                "cannot be erased without orphaning those records. Deactivate instead.",
            )

    rows = sb.table("attendance").select("selfie_url").eq("person_id", person_id).execute()
    paths = [r["selfie_url"] for r in (rows.data or []) if r.get("selfie_url")]
    if paths:
        sb.storage.from_(settings.selfie_bucket).remove(paths)

    # people delete cascades to attendance (person_id) and teacher_accounts.
    sb.table("people").delete().eq("id", person_id).execute()
    return {"selfies_removed": len(paths), "attendance_deleted": len(rows.data or [])}


def purge_old_selfies() -> int:
    sb = get_supabase()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=settings.retention_days)).isoformat()
    old = sb.table("attendance").select("id, selfie_url").lt("server_time", cutoff).neq("selfie_url", "").execute()
    paths = [r["selfie_url"] for r in (old.data or []) if r["selfie_url"]]
    if paths:
        sb.storage.from_(settings.selfie_bucket).remove(paths)
        for r in old.data:
            sb.table("attendance").update({"selfie_url": ""}).eq("id", r["id"]).execute()
    return len(paths)

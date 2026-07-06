"""Delete selfies older than RETENTION_DAYS; keep the textual log."""
from datetime import datetime, timedelta, timezone

from app.config import settings
from app.db import get_supabase


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

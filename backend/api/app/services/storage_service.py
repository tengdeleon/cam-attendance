"""Upload selfies to the private Supabase Storage bucket; issue signed URLs."""
from datetime import datetime, timezone

from app.config import settings
from app.db import get_supabase

SELFIE_URL_TTL = 60  # seconds; hard-constrained — do not raise without security review


def selfie_path(attendance_id: str) -> str:
    now = datetime.now(timezone.utc)
    return f"{now:%Y/%m/%d}/{attendance_id}.jpg"


def upload_selfie(attendance_id: str, content: bytes) -> str:
    """Store the image, return the object path saved on the attendance row."""
    sb = get_supabase()
    path = selfie_path(attendance_id)
    sb.storage.from_(settings.selfie_bucket).upload(
        path, content, {"content-type": "image/jpeg", "upsert": "true"}
    )
    return path


def signed_url(path: str, expires_in: int = SELFIE_URL_TTL) -> str:
    sb = get_supabase()
    # Hard ceiling: no caller may exceed the security-reviewed TTL, even by passing a
    # larger expires_in. The parameter only allows shorter windows.
    ttl = min(expires_in, SELFIE_URL_TTL)
    res = sb.storage.from_(settings.selfie_bucket).create_signed_url(path, ttl)
    return res.get("signedURL", "")

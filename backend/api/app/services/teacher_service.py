"""Provision a new teacher: Supabase Auth user + people row + teacher_accounts link.

The admin assigns the initial password. All three writes are treated as one unit:
if any step fails, earlier steps are rolled back so we never leave an orphaned
auth user, person, or account behind.
"""
import re

from fastapi import HTTPException, status

from app.db import get_supabase
from app.models.schemas import TeacherIn, TeacherOut

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def provision_teacher(body: TeacherIn) -> TeacherOut:
    if not _EMAIL_RE.match(body.email):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid email address")

    sb = get_supabase()
    email = body.email.strip().lower()

    # 1) Create the auth user (service-role admin API). email_confirm=True so she
    #    can sign in immediately with the assigned password (no email step).
    try:
        created = sb.auth.admin.create_user(
            {
                "email": email,
                "password": body.password,
                "email_confirm": True,
                "user_metadata": {"full_name": body.full_name},
            }
        )
    except Exception as e:  # gotrue raises on duplicate email / weak password
        msg = str(e)
        if "already" in msg.lower() or "registered" in msg.lower():
            raise HTTPException(status.HTTP_409_CONFLICT, "That email already has an account")
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Could not create login: {msg}")

    auth_user = getattr(created, "user", None)
    if auth_user is None or not getattr(auth_user, "id", None):
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Auth service returned no user")
    auth_user_id = auth_user.id

    # 2) Create the person record (role=teacher). Roll back the auth user on failure.
    try:
        person = (
            sb.table("people")
            .insert({"full_name": body.full_name, "role": "teacher"})
            .execute()
            .data[0]
        )
    except Exception as e:
        _safe_delete_auth_user(sb, auth_user_id)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Could not create person: {e}")

    person_id = person["id"]

    # 3) Link auth user -> person as a teacher account. Roll back both on failure.
    try:
        account = (
            sb.table("teacher_accounts")
            .insert(
                {
                    "person_id": person_id,
                    "auth_user_id": auth_user_id,
                    "is_admin": body.is_admin,
                }
            )
            .execute()
            .data[0]
        )
    except Exception as e:
        sb.table("people").delete().eq("id", person_id).execute()
        _safe_delete_auth_user(sb, auth_user_id)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Could not link teacher account: {e}")

    return TeacherOut(
        person_id=person_id,
        teacher_account_id=account["id"],
        auth_user_id=auth_user_id,
        full_name=body.full_name,
        email=email,
        is_admin=body.is_admin,
    )


def _safe_delete_auth_user(sb, auth_user_id: str) -> None:
    """Best-effort rollback of the auth user; never masks the original error."""
    try:
        sb.auth.admin.delete_user(auth_user_id)
    except Exception:
        pass

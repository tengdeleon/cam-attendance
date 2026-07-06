"""Auth dependency: resolve the current teacher from the bearer token."""
from fastapi import Depends, Header, HTTPException, status
from jose import JWTError

from app.core.security import verify_token
from app.db import get_supabase


async def current_teacher(authorization: str = Header(default="")) -> dict:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    token = authorization.split(" ", 1)[1]
    try:
        claims = verify_token(token)
    except JWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")

    auth_user_id = claims.get("sub")
    sb = get_supabase()
    res = (
        sb.table("teacher_accounts")
        .select("id, person_id, is_admin")
        .eq("auth_user_id", auth_user_id)
        .single()
        .execute()
    )
    if not res.data:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a teacher account")
    return res.data


async def current_admin(teacher: dict = Depends(current_teacher)) -> dict:
    if not teacher.get("is_admin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin only")
    return teacher

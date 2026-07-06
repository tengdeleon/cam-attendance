"""Verify Supabase-issued JWT access tokens sent by the app."""
from jose import JWTError, jwt

from app.config import settings


def verify_token(token: str) -> dict:
    """Return the JWT claims, or raise JWTError if invalid/expired."""
    return jwt.decode(
        token,
        settings.supabase_jwt_secret,
        algorithms=["HS256"],
        audience="authenticated",
    )

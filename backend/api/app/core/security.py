"""Verify Supabase-issued JWT access tokens sent by the app.

Newer Supabase projects sign access tokens with an asymmetric key (ES256)
published at /auth/v1/.well-known/jwks.json. Older projects use a shared
HS256 secret. We support both: pick the algorithm from the token header.
"""
import threading

import httpx
from jose import JWTError, jwt

from app.config import settings

_jwks_cache: dict | None = None
_jwks_lock = threading.Lock()


def _get_jwks() -> dict:
    global _jwks_cache
    if _jwks_cache is None:
        with _jwks_lock:
            if _jwks_cache is None:
                url = f"{settings.supabase_url}/auth/v1/.well-known/jwks.json"
                _jwks_cache = httpx.get(url, timeout=10).json()
    return _jwks_cache


def _key_for(token: str) -> tuple[dict | str, str]:
    """Return (key, algorithm) for this token based on its header."""
    header = jwt.get_unverified_header(token)
    alg = header.get("alg", "HS256")
    if alg == "HS256":
        return settings.supabase_jwt_secret, alg
    kid = header.get("kid")
    for jwk in _get_jwks().get("keys", []):
        if jwk.get("kid") == kid:
            return jwk, alg
    raise JWTError(f"No JWKS key found for kid={kid}")


def verify_token(token: str) -> dict:
    """Return the JWT claims, or raise JWTError if invalid/expired."""
    key, alg = _key_for(token)
    return jwt.decode(token, key, algorithms=[alg], audience="authenticated")

"""Pytest bootstrap for the CAM backend test suite.

Runs before any test module is collected, so it must set the config env vars
that `app.config.Settings.validate_boot()` enforces at import time. Without
this, importing `app.main` raises ConfigError during collection and takes down
the entire session (not just the failing module).

Requirements enforced by validate_boot() that these values satisfy:
- SUPABASE_URL must start with https://
- the three required secrets must not be empty or a known placeholder
"""

import os

# setdefault, not overwrite: a developer's real .env or exported CI secrets win.
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
os.environ.setdefault("SUPABASE_JWT_SECRET", "test-jwt-secret")
os.environ.setdefault("SELFIE_BUCKET", "selfies")
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:8081")

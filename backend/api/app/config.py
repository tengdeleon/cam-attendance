from pydantic_settings import BaseSettings, SettingsConfigDict

# Placeholder values that indicate an env var was copied from .env.example
# but never filled in. Treated as "missing" by the boot check.
_PLACEHOLDERS = {"", "changeme", "your-key", "your-secret", "todo", "xxx"}


class ConfigError(RuntimeError):
    """Raised at boot when required configuration is missing or malformed."""


class Settings(BaseSettings):
    supabase_url: str
    supabase_service_role_key: str
    supabase_jwt_secret: str
    selfie_bucket: str = "selfies"
    retention_days: int = 90
    allowed_origins: str = "http://localhost:8081"
    # Shared secret for scheduled jobs (GitHub Actions) to call /admin/purge-selfies
    # without a teacher JWT. Empty = cron access disabled.
    cron_secret: str = ""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    def validate_boot(self) -> None:
        """Fail fast with readable errors if the config can't run the app.

        pydantic already rejects an entirely-missing required var, but empty
        strings, leftover placeholders, and a malformed supabase_url pass its
        type check silently. Catch those here so a misconfigured deploy dies
        at boot with a clear message instead of failing on the first request.
        """
        errors: list[str] = []

        required = {
            "SUPABASE_URL": self.supabase_url,
            "SUPABASE_SERVICE_ROLE_KEY": self.supabase_service_role_key,
            "SUPABASE_JWT_SECRET": self.supabase_jwt_secret,
        }
        for name, value in required.items():
            if value.strip().lower() in _PLACEHOLDERS:
                errors.append(f"{name} is empty or still a placeholder")

        url = self.supabase_url.strip()
        if url and not url.startswith("https://"):
            errors.append(f"SUPABASE_URL must start with https:// (got: {url!r})")

        if self.retention_days < 1:
            errors.append(f"RETENTION_DAYS must be >= 1 (got: {self.retention_days})")

        if not self.origins:
            errors.append("ALLOWED_ORIGINS resolved to an empty list")

        if errors:
            raise ConfigError(
                "Invalid CAM API configuration:\n  - " + "\n  - ".join(errors)
            )


settings = Settings()  # type: ignore[call-arg]
settings.validate_boot()

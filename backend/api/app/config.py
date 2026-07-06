from pydantic_settings import BaseSettings, SettingsConfigDict


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


settings = Settings()  # type: ignore[call-arg]

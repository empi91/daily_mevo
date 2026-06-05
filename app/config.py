from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    environment: str = "development"
    app_version: str = "0.1.0"
    database_url: str | None = None
    supabase_url: str | None = None
    supabase_anon_key: str | None = None
    collector_enabled: bool = True
    collector_interval_seconds: int = 300
    log_level: str = "INFO"

    model_config = {"env_prefix": "MEVO_"}


settings = Settings()

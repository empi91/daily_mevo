from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    environment: str = "development"
    app_version: str = "1.2.0"
    database_url: str
    supabase_url: str | None = None
    supabase_anon_key: str | None = None
    collector_enabled: bool = True
    collector_interval_seconds: int = 300
    freshness_threshold_seconds: int = 3600
    reliability_threshold_reliable: int = 6
    reliability_threshold_uncertain: int = 2
    min_sample_count: int = 1
    cors_origins: list[str] = ["http://localhost:5173"]
    log_level: str = "INFO"
    jwt_secret: str
    jwt_lifetime_seconds: int = 2592000

    model_config = {"env_prefix": "MEVO_", "env_file": ".env", "extra": "ignore"}


settings = Settings()  # type: ignore[call-arg]

from contextlib import asynccontextmanager

import asyncpg
from fastapi import FastAPI
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    environment: str = "development"
    app_version: str = "0.1.0"
    database_url: str | None = None
    supabase_url: str | None = None
    supabase_anon_key: str | None = None

    model_config = {"env_prefix": "MEVO_"}


settings = Settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    pool = None
    if settings.database_url:
        dsn = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
        pool = await asyncpg.create_pool(dsn, min_size=2, max_size=5)
        app.state.db_pool = pool
    yield
    if pool:
        await pool.close()


app = FastAPI(
    title="MevoStats",
    version=settings.app_version,
    lifespan=lifespan,
)


@app.get("/health")
async def health() -> dict:
    db_status = "not_configured"
    if hasattr(app.state, "db_pool") and app.state.db_pool:
        try:
            async with app.state.db_pool.acquire() as conn:
                await conn.fetchval("SELECT 1")
            db_status = "connected"
        except Exception:
            db_status = "disconnected"
    return {
        "status": "ok",
        "version": settings.app_version,
        "environment": settings.environment,
        "database": db_status,
    }

import logging
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI

from app.config import settings
from app.db import create_pool, close_pool

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    if settings.database_url:
        try:
            app.state.db_pool = await create_pool(settings.database_url)
        except Exception:
            logger.exception("Failed to create database pool")
            app.state.db_pool = None
    yield
    if hasattr(app.state, "db_pool") and app.state.db_pool:
        await close_pool(app.state.db_pool)


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

import logging
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
from datetime import datetime, timezone

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

    scheduler = None
    if settings.collector_enabled and hasattr(app.state, "db_pool") and app.state.db_pool:
        try:
            from apscheduler.schedulers.asyncio import AsyncIOScheduler
            from app.collector import GBFSClient, sync_stations, collect_snapshots

            gbfs_client = GBFSClient()
            pool = app.state.db_pool

            async def run_station_sync() -> None:
                try:
                    count = await sync_stations(pool, gbfs_client)
                    app.state.last_station_sync_at = datetime.now(timezone.utc)
                    logger.info("Scheduled station sync: %d stations", count)
                except Exception:
                    logger.exception("Scheduled station sync failed")

            async def run_snapshot_collection() -> None:
                try:
                    count = await collect_snapshots(pool, gbfs_client)
                    app.state.last_collected_at = datetime.now(timezone.utc)
                    app.state.last_snapshot_count = count
                    logger.info("Scheduled snapshot collection: %d snapshots", count)
                except Exception:
                    logger.exception("Scheduled snapshot collection failed")

            scheduler = AsyncIOScheduler()
            scheduler.add_job(
                run_station_sync,
                "interval",
                hours=24,
                id="station_sync",
            )
            scheduler.add_job(
                run_snapshot_collection,
                "interval",
                seconds=settings.collector_interval_seconds,
                id="snapshot_collection",
            )
            scheduler.start()
            app.state.scheduler = scheduler

            await run_station_sync()
            await run_snapshot_collection()

        except Exception:
            logger.exception("Failed to start collector scheduler")

    yield

    if scheduler:
        scheduler.shutdown(wait=False)
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

    collector: dict = {"enabled": settings.collector_enabled}
    if not settings.collector_enabled:
        collector["status"] = "disabled"
    elif not (hasattr(app.state, "scheduler") and app.state.scheduler):
        collector["status"] = "stopped"
    else:
        sched = app.state.scheduler
        collector["status"] = "running" if sched.running else "stopped"

        last_collected = getattr(app.state, "last_collected_at", None)
        collector["last_collected_at"] = (
            last_collected.isoformat() if last_collected else None
        )

        snapshot_job = sched.get_job("snapshot_collection")
        collector["next_run_at"] = (
            snapshot_job.next_run_time.isoformat() if snapshot_job and snapshot_job.next_run_time else None
        )

        if hasattr(app.state, "db_pool") and app.state.db_pool:
            try:
                async with app.state.db_pool.acquire() as conn:
                    stations_count = await conn.fetchval(
                        "SELECT count(*) FROM stations WHERE is_active = TRUE"
                    )
                    collector["stations_count"] = stations_count
            except Exception:
                collector["stations_count"] = 0
        else:
            collector["stations_count"] = 0

    return {
        "status": "ok",
        "version": settings.app_version,
        "environment": settings.environment,
        "database": db_status,
        "collector": collector,
    }

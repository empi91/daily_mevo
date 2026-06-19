import asyncio
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from pathlib import Path

import logfire
import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.responses import FileResponse

from app.api import router as api_router
from app.auth import auth_router
from app.auth.db import engine as auth_engine
from app.config import settings
from app.db import create_pool, close_pool
from app.logging import setup_logging
from app.middleware import RequestContextMiddleware

setup_logging()

logger = structlog.stdlib.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    if settings.database_url:
        try:
            app.state.db_pool = await create_pool(settings.database_url)
        except Exception:
            logger.exception("Failed to create database pool")
            app.state.db_pool = None

    scheduler = None
    if (
        settings.collector_enabled
        and hasattr(app.state, "db_pool")
        and app.state.db_pool
    ):
        try:
            from apscheduler.schedulers.asyncio import AsyncIOScheduler
            from app.collector import GBFSClient, sync_stations, collect_snapshots
            from app.aggregation import aggregate_availability
            from app.retention import purge_old_snapshots
            from app.monitoring import check_db_size

            gbfs_client = GBFSClient()
            pool = app.state.db_pool

            async def run_station_sync() -> None:
                structlog.contextvars.clear_contextvars()
                structlog.contextvars.bind_contextvars(job_name="station_sync")
                with logfire.span(
                    "scheduled_job:{job_name}", job_name="station_sync"
                ) as span:
                    try:
                        count = await sync_stations(pool, gbfs_client)
                        app.state.last_station_sync_at = datetime.now(timezone.utc)
                        span.set_attribute("result_count", count)
                        logger.info(
                            "Scheduled station sync completed", station_count=count
                        )
                    except Exception:
                        logger.exception("Scheduled station sync failed")

            async def run_snapshot_collection() -> None:
                structlog.contextvars.clear_contextvars()
                structlog.contextvars.bind_contextvars(job_name="snapshot_collection")
                with logfire.span(
                    "scheduled_job:{job_name}", job_name="snapshot_collection"
                ) as span:
                    try:
                        count = await collect_snapshots(pool, gbfs_client)
                        app.state.last_collected_at = datetime.now(timezone.utc)
                        app.state.last_snapshot_count = count
                        span.set_attribute("result_count", count)
                        logger.info(
                            "Scheduled snapshot collection completed",
                            snapshot_count=count,
                        )
                    except Exception:
                        logger.exception("Scheduled snapshot collection failed")

            async def run_aggregation() -> None:
                structlog.contextvars.clear_contextvars()
                structlog.contextvars.bind_contextvars(job_name="aggregation")
                with logfire.span(
                    "scheduled_job:{job_name}", job_name="aggregation"
                ) as span:
                    try:
                        count = await aggregate_availability(pool)
                        span.set_attribute("result_count", count)
                        logger.info(
                            "Scheduled aggregation completed", rows_upserted=count
                        )
                    except Exception:
                        logger.exception("Scheduled aggregation failed")

            async def run_retention() -> None:
                structlog.contextvars.clear_contextvars()
                structlog.contextvars.bind_contextvars(job_name="retention")
                with logfire.span(
                    "scheduled_job:{job_name}", job_name="retention"
                ) as span:
                    try:
                        count = await purge_old_snapshots(
                            pool, settings.snapshot_retention_days
                        )
                        span.set_attribute("result_count", count)
                        logger.info("Scheduled retention completed", rows_deleted=count)
                    except Exception:
                        logger.exception("Scheduled retention failed")

            async def run_db_monitor() -> None:
                structlog.contextvars.clear_contextvars()
                structlog.contextvars.bind_contextvars(job_name="db_monitor")
                with logfire.span(
                    "scheduled_job:{job_name}", job_name="db_monitor"
                ) as span:
                    try:
                        size_mb = await check_db_size(
                            pool,
                            settings.ntfy_topic,
                            settings.db_size_warning_mb,
                            settings.db_size_critical_mb,
                        )
                        span.set_attribute("result_size_mb", size_mb)
                        logger.info(
                            "Scheduled DB monitor completed",
                            size_mb=round(size_mb, 1),
                        )
                    except Exception:
                        logger.exception("Scheduled DB monitor failed")

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
            scheduler.add_job(
                run_aggregation,
                "interval",
                hours=1,
                id="aggregation",
            )
            scheduler.add_job(
                run_retention,
                "interval",
                hours=24,
                id="retention",
            )
            scheduler.add_job(
                run_db_monitor,
                "interval",
                hours=settings.db_monitor_interval_hours,
                id="db_monitor",
            )
            scheduler.start()
            app.state.scheduler = scheduler

            def _log_task_exception(t: asyncio.Task[None]) -> None:
                if not t.cancelled() and t.exception():
                    logger.error("Startup task failed", exc_info=t.exception())

            sync_task = asyncio.create_task(run_station_sync())
            sync_task.add_done_callback(_log_task_exception)
            snapshot_task = asyncio.create_task(run_snapshot_collection())
            snapshot_task.add_done_callback(_log_task_exception)
            retention_task = asyncio.create_task(run_retention())
            retention_task.add_done_callback(_log_task_exception)

        except Exception:
            logger.exception("Failed to start collector scheduler")

    yield

    if scheduler:
        scheduler.shutdown(wait=False)
    await auth_engine.dispose()
    if hasattr(app.state, "db_pool") and app.state.db_pool:
        await close_pool(app.state.db_pool)


app = FastAPI(
    title="MevoStats",
    version=settings.app_version,
    lifespan=lifespan,
)
logfire.instrument_fastapi(app)
app.add_middleware(RequestContextMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router, prefix="/api/v1")
app.include_router(auth_router, prefix="/api/v1")

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"


@app.get("/health")
async def health() -> dict:
    db_status = "not_configured"
    stations_count = 0
    data_freshness: dict = {
        "last_snapshot_at": None,
        "age_seconds": None,
        "threshold_seconds": settings.freshness_threshold_seconds,
        "fresh": False,
    }

    if hasattr(app.state, "db_pool") and app.state.db_pool:
        try:
            async with app.state.db_pool.acquire() as conn:
                await conn.fetchval("SELECT 1")
                db_status = "connected"

                stations_count = await conn.fetchval(
                    "SELECT count(*) FROM stations WHERE is_active = TRUE"
                )

                last_snapshot_at = await conn.fetchval(
                    "SELECT MAX(collected_at) FROM snapshots"
                )
                if last_snapshot_at is not None:
                    now = datetime.now(timezone.utc)
                    if last_snapshot_at.tzinfo is None:
                        last_snapshot_at = last_snapshot_at.replace(tzinfo=timezone.utc)
                    age_seconds = int((now - last_snapshot_at).total_seconds())
                    data_freshness["last_snapshot_at"] = last_snapshot_at.isoformat()
                    data_freshness["age_seconds"] = age_seconds
                    data_freshness["fresh"] = (
                        age_seconds <= settings.freshness_threshold_seconds
                    )
        except Exception:
            if db_status != "connected":
                db_status = "disconnected"
            logger.warning("Health check DB query failed", exc_info=True)

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
            snapshot_job.next_run_time.isoformat()
            if snapshot_job and snapshot_job.next_run_time
            else None
        )

        collector["stations_count"] = stations_count

    if not data_freshness["fresh"] and data_freshness["last_snapshot_at"] is not None:
        logger.warning(
            "data_freshness_degraded",
            age_seconds=data_freshness["age_seconds"],
            threshold_seconds=data_freshness["threshold_seconds"],
        )

    retention = {
        "enabled": True,
        "retention_days": settings.snapshot_retention_days,
    }

    db_size: dict | None = None
    if hasattr(app.state, "db_pool") and app.state.db_pool:
        try:
            async with app.state.db_pool.acquire() as conn:
                row = await conn.fetchrow(
                    "SELECT size_bytes FROM db_size_log ORDER BY id DESC LIMIT 1"
                )
                if row:
                    db_size = {
                        "last_check_mb": round(row["size_bytes"] / (1024 * 1024), 1),
                        "warning_threshold_mb": settings.db_size_warning_mb,
                        "critical_threshold_mb": settings.db_size_critical_mb,
                    }
        except Exception:
            pass

    return {
        "status": "ok",
        "version": settings.app_version,
        "environment": settings.environment,
        "database": db_status,
        "collector": collector,
        "data_freshness": data_freshness,
        "retention": retention,
        "db_size": db_size,
    }


if FRONTEND_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str) -> FileResponse:
        file_path = (FRONTEND_DIR / full_path).resolve()
        if file_path.is_relative_to(FRONTEND_DIR.resolve()) and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(FRONTEND_DIR / "index.html")

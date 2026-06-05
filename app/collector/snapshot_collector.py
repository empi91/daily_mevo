from datetime import datetime, timezone

import asyncpg
import structlog

from app.collector.gbfs_client import GBFSClient

logger = structlog.stdlib.get_logger()


async def collect_snapshots(pool: asyncpg.Pool, client: GBFSClient) -> int:
    statuses = await client.fetch_station_status()
    if statuses is None:
        logger.warning("Snapshot collection skipped: failed to fetch station status")
        return 0

    collected_at = datetime.now(timezone.utc)

    async with pool.acquire() as conn:
        active_ids = {
            r["station_id"]
            for r in await conn.fetch(
                "SELECT station_id FROM stations WHERE is_active = TRUE"
            )
        }

        rows = [
            (
                s.station_id,
                collected_at,
                s.bikes_count,
                s.ebikes_count,
                s.num_docks_available,
                s.is_installed,
                s.is_renting,
                s.is_returning,
            )
            for s in statuses
            if s.station_id in active_ids
        ]

        if rows:
            await conn.executemany(
                """
                INSERT INTO snapshots
                    (station_id, collected_at, bikes_available, ebikes_available,
                     docks_available, is_installed, is_renting, is_returning)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """,
                rows,
            )

    duration_ms = (datetime.now(timezone.utc) - collected_at).total_seconds() * 1000
    logger.info(
        "Snapshot collection completed",
        snapshot_count=len(rows),
        duration_ms=round(duration_ms, 1),
    )
    return len(rows)

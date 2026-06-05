import asyncpg
import structlog

from app.collector.gbfs_client import GBFSClient

logger = structlog.stdlib.get_logger()


async def sync_stations(pool: asyncpg.Pool, client: GBFSClient) -> int:
    stations = await client.fetch_station_info()
    if stations is None:
        logger.warning("Station sync skipped: failed to fetch station info")
        return 0

    async with pool.acquire() as conn:
        fetched_ids: list[str] = []
        for s in stations:
            fetched_ids.append(s.station_id)
            await conn.execute(
                """
                INSERT INTO stations (station_id, name, address, lat, lon, capacity, is_virtual, is_active, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, now())
                ON CONFLICT (station_id) DO UPDATE SET
                    name = EXCLUDED.name,
                    address = EXCLUDED.address,
                    lat = EXCLUDED.lat,
                    lon = EXCLUDED.lon,
                    capacity = EXCLUDED.capacity,
                    is_virtual = EXCLUDED.is_virtual,
                    is_active = TRUE,
                    updated_at = now()
                """,
                s.station_id,
                s.name,
                s.address,
                s.lat,
                s.lon,
                s.capacity,
                s.is_virtual_station,
            )

        if fetched_ids:
            await conn.execute(
                """
                UPDATE stations SET is_active = FALSE, updated_at = now()
                WHERE station_id != ALL($1::text[]) AND is_active = TRUE
                """,
                fetched_ids,
            )

    logger.info("Station sync completed: %d stations upserted", len(stations))
    return len(stations)

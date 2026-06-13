import asyncpg
import structlog

from app.collector.gbfs_client import GBFSClient

logger = structlog.stdlib.get_logger()


async def sync_stations(pool: asyncpg.Pool, client: GBFSClient) -> int:
    stations = await client.fetch_station_info()
    if stations is None:
        logger.warning("Station sync skipped: failed to fetch station info")
        return 0

    station_ids = [s.station_id for s in stations]
    names = [s.name for s in stations]
    addresses = [s.address for s in stations]
    lats = [s.lat for s in stations]
    lons = [s.lon for s in stations]
    capacities = [s.capacity for s in stations]
    is_virtuals = [s.is_virtual_station for s in stations]

    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                INSERT INTO stations (station_id, name, address, lat, lon, capacity, is_virtual, is_active, updated_at)
                SELECT u.station_id, u.name, u.address, u.lat, u.lon, u.capacity, u.is_virtual, TRUE, now()
                FROM unnest($1::text[], $2::text[], $3::text[], $4::float8[], $5::float8[], $6::int[], $7::boolean[])
                    AS u(station_id, name, address, lat, lon, capacity, is_virtual)
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
                station_ids,
                names,
                addresses,
                lats,
                lons,
                capacities,
                is_virtuals,
            )

            if station_ids:
                await conn.execute(
                    """
                    UPDATE stations SET is_active = FALSE, updated_at = now()
                    WHERE station_id != ALL($1::text[]) AND is_active = TRUE
                    """,
                    station_ids,
                )

    logger.info("Station sync completed", station_count=len(stations))
    return len(stations)

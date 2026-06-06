import asyncpg
import structlog

logger = structlog.stdlib.get_logger()

LOCAL_TZ = "Europe/Warsaw"


async def aggregate_availability(pool: asyncpg.Pool) -> int:
    async with pool.acquire() as conn, conn.transaction():
        result = await conn.execute(f"""
            INSERT INTO station_availability (station_id, day_of_week, time_slot, avg_bikes, avg_ebikes, sample_count, updated_at)
            SELECT
                station_id,
                (EXTRACT(ISODOW FROM local_ts) - 1)::SMALLINT AS day_of_week,
                (date_trunc('hour', local_ts)
                 + INTERVAL '15 min' * FLOOR(EXTRACT(MINUTE FROM local_ts) / 15))::TIME AS time_slot,
                AVG(bikes_available)::DOUBLE PRECISION AS avg_bikes,
                AVG(ebikes_available)::DOUBLE PRECISION AS avg_ebikes,
                COUNT(*)::INTEGER AS sample_count,
                now() AS updated_at
            FROM (
                SELECT
                    station_id,
                    bikes_available,
                    ebikes_available,
                    (collected_at AT TIME ZONE '{LOCAL_TZ}') AS local_ts
                FROM snapshots
            ) s
            GROUP BY station_id, day_of_week, time_slot
            ON CONFLICT (station_id, day_of_week, time_slot)
            DO UPDATE SET
                avg_bikes = EXCLUDED.avg_bikes,
                avg_ebikes = EXCLUDED.avg_ebikes,
                sample_count = EXCLUDED.sample_count,
                updated_at = EXCLUDED.updated_at
        """)
        rows_affected = int(result.split()[-1]) if result else 0
        logger.info("Aggregation completed", rows_upserted=rows_affected)
        return rows_affected

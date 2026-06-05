import asyncpg
import structlog

logger = structlog.stdlib.get_logger()


async def aggregate_availability(pool: asyncpg.Pool) -> int:
    async with pool.acquire() as conn:
        result = await conn.execute("""
            INSERT INTO station_availability (station_id, day_of_week, time_slot, avg_bikes, avg_ebikes, sample_count, updated_at)
            SELECT
                station_id,
                (EXTRACT(ISODOW FROM collected_at) - 1)::SMALLINT AS day_of_week,
                (date_trunc('hour', collected_at::time)
                 + INTERVAL '15 min' * FLOOR(EXTRACT(MINUTE FROM collected_at) / 15))::TIME AS time_slot,
                AVG(bikes_available)::DOUBLE PRECISION AS avg_bikes,
                AVG(ebikes_available)::DOUBLE PRECISION AS avg_ebikes,
                COUNT(*)::INTEGER AS sample_count,
                now() AS updated_at
            FROM snapshots
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

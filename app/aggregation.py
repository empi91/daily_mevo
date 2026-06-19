import asyncpg
import structlog

logger = structlog.stdlib.get_logger()

LOCAL_TZ = "Europe/Warsaw"


async def aggregate_availability(pool: asyncpg.Pool) -> int:
    async with pool.acquire() as conn, conn.transaction():
        watermark_row = await conn.fetchrow(
            "SELECT last_processed_id FROM agg_watermark WHERE id = 1"
        )
        if watermark_row is None:
            logger.error("agg_watermark row missing — run migration 004")
            return 0

        watermark_from: int = watermark_row["last_processed_id"]

        max_id_row = await conn.fetchrow(
            "SELECT COALESCE(MAX(id), 0) AS max_id FROM snapshots"
        )
        assert max_id_row is not None
        current_max: int = max_id_row["max_id"]

        if current_max <= watermark_from:
            logger.info(
                "Aggregation skipped — no new snapshots",
                watermark_from=watermark_from,
                watermark_to=watermark_from,
                rows_upserted=0,
                snapshots_processed=0,
            )
            return 0

        result = await conn.execute(
            f"""
            WITH new_data AS (
                SELECT
                    station_id,
                    (EXTRACT(ISODOW FROM local_ts) - 1)::SMALLINT AS day_of_week,
                    (date_trunc('hour', local_ts)
                     + INTERVAL '15 min' * FLOOR(EXTRACT(MINUTE FROM local_ts) / 15))::TIME AS time_slot,
                    SUM(bikes_available)::DOUBLE PRECISION AS sum_bikes,
                    SUM(ebikes_available)::DOUBLE PRECISION AS sum_ebikes,
                    COUNT(*)::INTEGER AS cnt
                FROM (
                    SELECT
                        station_id,
                        bikes_available,
                        ebikes_available,
                        (collected_at AT TIME ZONE '{LOCAL_TZ}') AS local_ts
                    FROM snapshots
                    WHERE id > $1
                ) s
                GROUP BY station_id, day_of_week, time_slot
            )
            INSERT INTO station_availability
                (station_id, day_of_week, time_slot, avg_bikes, avg_ebikes, sample_count, updated_at)
            SELECT
                station_id,
                day_of_week,
                time_slot,
                sum_bikes / cnt,
                sum_ebikes / cnt,
                cnt,
                now()
            FROM new_data
            ON CONFLICT (station_id, day_of_week, time_slot)
            DO UPDATE SET
                avg_bikes = (station_availability.avg_bikes * station_availability.sample_count + EXCLUDED.avg_bikes * EXCLUDED.sample_count)
                            / (station_availability.sample_count + EXCLUDED.sample_count),
                avg_ebikes = (station_availability.avg_ebikes * station_availability.sample_count + EXCLUDED.avg_ebikes * EXCLUDED.sample_count)
                             / (station_availability.sample_count + EXCLUDED.sample_count),
                sample_count = station_availability.sample_count + EXCLUDED.sample_count,
                updated_at = EXCLUDED.updated_at
        """,
            watermark_from,
        )

        rows_upserted = int(result.split()[-1]) if result else 0

        await conn.execute(
            "UPDATE agg_watermark SET last_processed_id = $1, updated_at = now()",
            current_max,
        )

        logger.info(
            "Aggregation completed",
            rows_upserted=rows_upserted,
            watermark_from=watermark_from,
            watermark_to=current_max,
            snapshots_processed=current_max - watermark_from,
        )
        return rows_upserted

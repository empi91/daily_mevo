import asyncpg
import structlog

logger = structlog.stdlib.get_logger()

BATCH_SIZE = 100_000


async def purge_old_snapshots(pool: asyncpg.Pool, retention_days: int) -> int:
    total_deleted = 0
    batch_num = 0

    async with pool.acquire() as conn:
        watermark_row = await conn.fetchrow(
            "SELECT last_processed_id FROM agg_watermark WHERE id = 1"
        )
        if watermark_row is None:
            logger.error("agg_watermark row missing — cannot run retention")
            return 0

        watermark: int = watermark_row["last_processed_id"]
        if watermark == 0:
            logger.info(
                "Watermark is 0 — no snapshots aggregated yet, skipping retention"
            )
            return 0

        while True:
            batch_num += 1
            result = await conn.execute(
                """
                DELETE FROM snapshots
                WHERE id IN (
                    SELECT id FROM snapshots
                    WHERE collected_at < now() - make_interval(days => $1)
                      AND id <= $2
                    LIMIT $3
                )
                """,
                retention_days,
                watermark,
                BATCH_SIZE,
            )
            rows_deleted = int(result.split()[-1]) if result else 0
            total_deleted += rows_deleted

            logger.info(
                "Retention batch completed",
                batch=batch_num,
                rows_deleted=rows_deleted,
                total_deleted=total_deleted,
            )

            if rows_deleted < BATCH_SIZE:
                break

    return total_deleted

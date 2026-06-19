import httpx
import asyncpg
import structlog

logger = structlog.stdlib.get_logger()


async def check_db_size(
    pool: asyncpg.Pool,
    ntfy_topic: str | None,
    warning_mb: int,
    critical_mb: int,
) -> float:
    async with pool.acquire() as conn:
        size_bytes: int = await conn.fetchval(
            "SELECT pg_database_size(current_database())"
        )
        await conn.execute(
            "INSERT INTO db_size_log (size_bytes) VALUES ($1)", size_bytes
        )

    size_mb = size_bytes / (1024 * 1024)
    logger.info("DB size check", size_mb=round(size_mb, 1), size_bytes=size_bytes)

    if ntfy_topic and size_mb >= warning_mb:
        await _send_ntfy_alert(ntfy_topic, size_mb, critical_mb)

    return size_mb


async def _send_ntfy_alert(topic: str, size_mb: float, critical_mb: int) -> None:
    is_critical = size_mb >= critical_mb
    priority = "5" if is_critical else "3"
    level = "CRITICAL" if is_critical else "WARNING"
    title = f"MevoStats DB Storage {level}"
    body = f"{level}: DB at {size_mb:.0f}MB"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                f"https://ntfy.sh/{topic}",
                content=body,
                headers={"Priority": priority, "Title": title},
            )
        logger.info("ntfy alert sent", level=level, size_mb=round(size_mb, 1))
    except Exception:
        logger.warning("Failed to send ntfy alert", exc_info=True)

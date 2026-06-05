import asyncpg


async def create_pool(dsn: str) -> asyncpg.Pool:
    normalized = dsn.replace("postgresql+asyncpg://", "postgresql://")
    pool = await asyncpg.create_pool(
        normalized, min_size=2, max_size=5, statement_cache_size=0
    )
    assert pool is not None
    return pool


async def close_pool(pool: asyncpg.Pool) -> None:
    await pool.close()

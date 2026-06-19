from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
import asyncpg

from tests.conftest import insert_test_snapshots


pytestmark = pytest.mark.integration


@pytest_asyncio.fixture(loop_scope="session")
async def seeded_retention_data(
    db_pool: asyncpg.Pool,
) -> dict[str, list[int]]:
    now = datetime.now(timezone.utc)
    async with db_pool.acquire() as conn:
        old_ids = await insert_test_snapshots(
            conn,
            "ST-OLD",
            [
                {
                    "bikes_available": 5,
                    "ebikes_available": 2,
                    "docks_available": 13,
                    "collected_at": now - timedelta(days=20),
                },
                {
                    "bikes_available": 3,
                    "ebikes_available": 1,
                    "docks_available": 16,
                    "collected_at": now - timedelta(days=16),
                },
            ],
        )
        recent_ids = await insert_test_snapshots(
            conn,
            "ST-NEW",
            [
                {
                    "bikes_available": 4,
                    "ebikes_available": 3,
                    "docks_available": 13,
                    "collected_at": now - timedelta(days=1),
                },
            ],
        )
        max_id = max(old_ids + recent_ids)
        await conn.execute("UPDATE agg_watermark SET last_processed_id = $1", max_id)
    return {"old": old_ids, "recent": recent_ids}


@pytest.mark.asyncio(loop_scope="session")
async def test_purge_deletes_old_snapshots(
    db_pool: asyncpg.Pool, seeded_retention_data: dict[str, list[int]]
) -> None:
    from app.retention import purge_old_snapshots

    deleted = await purge_old_snapshots(db_pool, retention_days=14)
    assert deleted == 2

    async with db_pool.acquire() as conn:
        for sid in seeded_retention_data["old"]:
            row = await conn.fetchrow("SELECT id FROM snapshots WHERE id = $1", sid)
            assert row is None

        for sid in seeded_retention_data["recent"]:
            row = await conn.fetchrow("SELECT id FROM snapshots WHERE id = $1", sid)
            assert row is not None


@pytest.mark.asyncio(loop_scope="session")
async def test_purge_respects_watermark(db_pool: asyncpg.Pool) -> None:
    from app.retention import purge_old_snapshots

    now = datetime.now(timezone.utc)
    async with db_pool.acquire() as conn:
        await conn.execute("TRUNCATE snapshots CASCADE")
        ids = await insert_test_snapshots(
            conn,
            "ST-WM",
            [
                {
                    "bikes_available": 2,
                    "ebikes_available": 1,
                    "docks_available": 17,
                    "collected_at": now - timedelta(days=20),
                },
            ],
        )
        await conn.execute(
            "UPDATE agg_watermark SET last_processed_id = $1", ids[0] - 1
        )

    deleted = await purge_old_snapshots(db_pool, retention_days=14)
    assert deleted == 0

    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("SELECT id FROM snapshots WHERE id = $1", ids[0])
        assert row is not None


@pytest.mark.asyncio(loop_scope="session")
async def test_purge_empty_table(db_pool: asyncpg.Pool) -> None:
    from app.retention import purge_old_snapshots

    async with db_pool.acquire() as conn:
        await conn.execute("TRUNCATE snapshots CASCADE")
        await conn.execute("UPDATE agg_watermark SET last_processed_id = 1000")

    deleted = await purge_old_snapshots(db_pool, retention_days=14)
    assert deleted == 0


@pytest.mark.asyncio(loop_scope="session")
async def test_purge_skips_when_watermark_zero(db_pool: asyncpg.Pool) -> None:
    from app.retention import purge_old_snapshots

    async with db_pool.acquire() as conn:
        await conn.execute("UPDATE agg_watermark SET last_processed_id = 0")

    deleted = await purge_old_snapshots(db_pool, retention_days=14)
    assert deleted == 0

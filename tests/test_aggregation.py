from datetime import datetime, timezone

import asyncpg
import pytest

from app.aggregation import aggregate_availability
from tests.conftest import insert_test_snapshots

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="session")]

# All timestamps target Monday 2026-06-15 in Warsaw (CEST = UTC+2).
# ISODOW Monday = 1 → day_of_week = 0.

def _utc(hour: int, minute: int) -> datetime:
    return datetime(2026, 6, 15, hour, minute, tzinfo=timezone.utc)


async def _get_availability(
    conn: asyncpg.Connection, station_id: str
) -> list[asyncpg.Record]:
    return list(await conn.fetch(
        """
        SELECT day_of_week, time_slot, avg_bikes, avg_ebikes, sample_count
        FROM station_availability
        WHERE station_id = $1
        ORDER BY day_of_week, time_slot
        """,
        station_id,
    ))


async def test_aggregation_first_run_computes_simple_mean(
    db_pool: asyncpg.Pool,
) -> None:
    async with db_pool.acquire() as conn:
        # 3 snapshots in timeslot 08:00 (UTC 06:00-06:14 → Warsaw 08:00-08:14)
        await insert_test_snapshots(
            conn,
            "AGG-001",
            [
                {"bikes_available": 4, "ebikes_available": 2, "docks_available": 10, "collected_at": _utc(6, 0)},
                {"bikes_available": 6, "ebikes_available": 4, "docks_available": 10, "collected_at": _utc(6, 5)},
                {"bikes_available": 8, "ebikes_available": 6, "docks_available": 10, "collected_at": _utc(6, 10)},
            ],
        )
        # 1 snapshot in timeslot 08:15 (UTC 06:20 → Warsaw 08:20)
        await insert_test_snapshots(
            conn,
            "AGG-001",
            [
                {"bikes_available": 10, "ebikes_available": 0, "docks_available": 10, "collected_at": _utc(6, 20)},
            ],
        )

    result = await aggregate_availability(db_pool)
    assert result > 0

    async with db_pool.acquire() as conn:
        rows = await _get_availability(conn, "AGG-001")

    assert len(rows) == 2

    slot_0800 = rows[0]
    assert slot_0800["day_of_week"] == 0
    assert slot_0800["avg_bikes"] == pytest.approx(6.0)       # (4+6+8)/3
    assert slot_0800["avg_ebikes"] == pytest.approx(4.0)      # (2+4+6)/3
    assert slot_0800["sample_count"] == 3

    slot_0815 = rows[1]
    assert slot_0815["day_of_week"] == 0
    assert slot_0815["avg_bikes"] == pytest.approx(10.0)
    assert slot_0815["avg_ebikes"] == pytest.approx(0.0)
    assert slot_0815["sample_count"] == 1


async def test_aggregation_single_snapshot_exact_value(
    db_pool: asyncpg.Pool,
) -> None:
    async with db_pool.acquire() as conn:
        await insert_test_snapshots(
            conn,
            "AGG-002",
            [
                {"bikes_available": 5, "ebikes_available": 3, "docks_available": 12, "collected_at": _utc(7, 0)},
            ],
        )

    await aggregate_availability(db_pool)

    async with db_pool.acquire() as conn:
        rows = await _get_availability(conn, "AGG-002")

    assert len(rows) == 1
    assert rows[0]["avg_bikes"] == pytest.approx(5.0)
    assert rows[0]["avg_ebikes"] == pytest.approx(3.0)
    assert rows[0]["sample_count"] == 1


async def test_aggregation_weighted_merge_correct(
    db_pool: asyncpg.Pool,
) -> None:
    # Batch A: 2 snapshots → avg_bikes_a = 5.0, avg_ebikes_a = 3.0
    async with db_pool.acquire() as conn:
        await insert_test_snapshots(
            conn,
            "AGG-003",
            [
                {"bikes_available": 4, "ebikes_available": 2, "docks_available": 10, "collected_at": _utc(8, 0)},
                {"bikes_available": 6, "ebikes_available": 4, "docks_available": 10, "collected_at": _utc(8, 5)},
            ],
        )

    await aggregate_availability(db_pool)

    # Batch B: 3 snapshots → avg_bikes_b = 10.0, avg_ebikes_b = 6.0
    async with db_pool.acquire() as conn:
        await insert_test_snapshots(
            conn,
            "AGG-003",
            [
                {"bikes_available": 10, "ebikes_available": 6, "docks_available": 10, "collected_at": _utc(8, 7)},
                {"bikes_available": 10, "ebikes_available": 6, "docks_available": 10, "collected_at": _utc(8, 9)},
                {"bikes_available": 10, "ebikes_available": 6, "docks_available": 10, "collected_at": _utc(8, 11)},
            ],
        )

    await aggregate_availability(db_pool)

    async with db_pool.acquire() as conn:
        rows = await _get_availability(conn, "AGG-003")

    assert len(rows) == 1
    # Weighted merge: (5.0*2 + 10.0*3) / (2+3) = 40/5 = 8.0
    assert rows[0]["avg_bikes"] == pytest.approx(8.0)
    # (3.0*2 + 6.0*3) / (2+3) = 24/5 = 4.8
    assert rows[0]["avg_ebikes"] == pytest.approx(4.8)
    assert rows[0]["sample_count"] == 5


async def test_aggregation_gap_leaves_old_slots_intact(
    db_pool: asyncpg.Pool,
) -> None:
    # Timeslot T1: 10:00 (UTC 08:00)
    async with db_pool.acquire() as conn:
        await insert_test_snapshots(
            conn,
            "AGG-004",
            [
                {"bikes_available": 3, "ebikes_available": 1, "docks_available": 10, "collected_at": _utc(8, 0)},
                {"bikes_available": 7, "ebikes_available": 3, "docks_available": 10, "collected_at": _utc(8, 10)},
            ],
        )

    await aggregate_availability(db_pool)

    # Timeslot T2: 12:00 (UTC 10:00) — gap, no snapshots between 10:15 and 12:00
    async with db_pool.acquire() as conn:
        await insert_test_snapshots(
            conn,
            "AGG-004",
            [
                {"bikes_available": 20, "ebikes_available": 10, "docks_available": 10, "collected_at": _utc(10, 0)},
            ],
        )

    await aggregate_availability(db_pool)

    async with db_pool.acquire() as conn:
        rows = await _get_availability(conn, "AGG-004")

    assert len(rows) == 2

    t1 = rows[0]
    assert t1["avg_bikes"] == pytest.approx(5.0)    # (3+7)/2 unchanged
    assert t1["avg_ebikes"] == pytest.approx(2.0)   # (1+3)/2 unchanged
    assert t1["sample_count"] == 2

    t2 = rows[1]
    assert t2["avg_bikes"] == pytest.approx(20.0)
    assert t2["avg_ebikes"] == pytest.approx(10.0)
    assert t2["sample_count"] == 1


async def test_aggregation_double_run_is_idempotent(
    db_pool: asyncpg.Pool,
) -> None:
    async with db_pool.acquire() as conn:
        await insert_test_snapshots(
            conn,
            "AGG-005",
            [
                {"bikes_available": 4, "ebikes_available": 2, "docks_available": 10, "collected_at": _utc(9, 0)},
                {"bikes_available": 6, "ebikes_available": 4, "docks_available": 10, "collected_at": _utc(9, 5)},
            ],
        )

    first_result = await aggregate_availability(db_pool)
    assert first_result > 0

    second_result = await aggregate_availability(db_pool)
    assert second_result == 0

    async with db_pool.acquire() as conn:
        rows = await _get_availability(conn, "AGG-005")

    assert len(rows) == 1
    assert rows[0]["avg_bikes"] == pytest.approx(5.0)
    assert rows[0]["avg_ebikes"] == pytest.approx(3.0)
    assert rows[0]["sample_count"] == 2


async def test_aggregation_skips_when_no_new_snapshots(
    db_pool: asyncpg.Pool,
) -> None:
    result = await aggregate_availability(db_pool)
    assert result == 0

    async with db_pool.acquire() as conn:
        count = await conn.fetchval("SELECT COUNT(*) FROM station_availability")
    assert count == 0

from __future__ import annotations

import os
from typing import AsyncGenerator

import asyncpg
import pytest
import pytest_asyncio
from alembic import command
from alembic.config import Config


@pytest.fixture
def station_info_payload() -> dict:
    return {
        "data": {
            "stations": [
                {
                    "station_id": "7694",
                    "name": "GPG019",
                    "address": "ul. Kazimierza Kraszewskiego 1, 83-010 Straszyn",
                    "lat": 54.27515,
                    "lon": 18.58503,
                    "is_virtual_station": True,
                    "capacity": 10,
                    "station_area": {"type": "MultiPolygon", "coordinates": []},
                    "rental_uris": {
                        "android": "rowermevo://stations/7694",
                        "ios": "rowermevo://stations/7694",
                    },
                },
                {
                    "station_id": "7661",
                    "name": "GPG017",
                    "address": "ul. Radańska 2-4, 83-004 Radunica",
                    "lat": 54.279478,
                    "lon": 18.64362,
                    "is_virtual_station": True,
                    "capacity": 10,
                    "station_area": {"type": "MultiPolygon", "coordinates": []},
                    "rental_uris": {
                        "android": "rowermevo://stations/7661",
                        "ios": "rowermevo://stations/7661",
                    },
                },
            ]
        }
    }


@pytest.fixture
def station_status_payload() -> dict:
    return {
        "data": {
            "stations": [
                {
                    "station_id": "7694",
                    "is_installed": True,
                    "is_renting": True,
                    "is_returning": True,
                    "last_reported": 1780651600,
                    "num_vehicles_available": 3,
                    "num_bikes_available": 3,
                    "num_docks_available": 7,
                    "vehicle_types_available": [
                        {"vehicle_type_id": "bike", "count": 2},
                        {"vehicle_type_id": "ebike", "count": 1},
                    ],
                },
                {
                    "station_id": "7661",
                    "is_installed": True,
                    "is_renting": False,
                    "is_returning": True,
                    "last_reported": 1780651600,
                    "num_vehicles_available": 0,
                    "num_bikes_available": 0,
                    "num_docks_available": 10,
                    "vehicle_types_available": [
                        {"vehicle_type_id": "bike", "count": 0},
                        {"vehicle_type_id": "ebike", "count": 0},
                    ],
                },
            ]
        }
    }


def _get_test_database_url() -> str | None:
    return os.environ.get("MEVO_TEST_DATABASE_URL")


def _run_alembic(direction: str) -> None:
    test_url = _get_test_database_url()
    assert test_url is not None
    original = os.environ.get("MEVO_DATABASE_URL")
    os.environ["MEVO_DATABASE_URL"] = test_url
    try:
        cfg = Config("alembic.ini")
        if direction == "upgrade":
            command.upgrade(cfg, "head")
        else:
            command.downgrade(cfg, "base")
    finally:
        if original is not None:
            os.environ["MEVO_DATABASE_URL"] = original
        else:
            os.environ.pop("MEVO_DATABASE_URL", None)


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def db_pool() -> AsyncGenerator[asyncpg.Pool, None]:
    test_url = _get_test_database_url()
    if not test_url:
        pytest.skip("TEST_DATABASE_URL not set — skipping integration tests")

    dsn = test_url.replace("postgresql+asyncpg://", "postgresql://")

    _run_alembic("upgrade")

    pool = await asyncpg.create_pool(dsn)
    assert pool is not None
    yield pool

    await pool.close()
    _run_alembic("downgrade")


@pytest_asyncio.fixture(autouse=True, loop_scope="session")
async def clean_tables(request: pytest.FixtureRequest, db_pool: asyncpg.Pool) -> None:
    if "integration" not in [m.name for m in request.node.iter_markers()]:
        return
    async with db_pool.acquire() as conn:
        await conn.execute(
            "TRUNCATE stations, snapshots, station_availability CASCADE"
        )
        await conn.execute(
            "UPDATE agg_watermark SET last_processed_id = 0, updated_at = now()"
        )


async def insert_test_snapshots(
    conn: asyncpg.Connection,
    station_id: str,
    snapshots_data: list[dict],
    station_name: str | None = None,
) -> list[int]:
    existing = await conn.fetchval(
        "SELECT station_id FROM stations WHERE station_id = $1", station_id
    )
    if existing is None:
        await conn.execute(
            """
            INSERT INTO stations (station_id, name, address, lat, lon, capacity, is_virtual, is_active)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """,
            station_id,
            station_name or f"Test Station {station_id}",
            "Test Address",
            54.35,
            18.65,
            20,
            False,
            True,
        )

    ids: list[int] = []
    for snap in snapshots_data:
        row = await conn.fetchrow(
            """
            INSERT INTO snapshots
                (station_id, bikes_available, ebikes_available, docks_available,
                 is_installed, is_renting, is_returning, collected_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id
            """,
            station_id,
            snap["bikes_available"],
            snap["ebikes_available"],
            snap["docks_available"],
            snap.get("is_installed", True),
            snap.get("is_renting", True),
            snap.get("is_returning", True),
            snap["collected_at"],
        )
        assert row is not None
        ids.append(row["id"])
    return ids

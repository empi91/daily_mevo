from __future__ import annotations

from typing import Any

import httpx
import pytest
import pytest_asyncio

import asyncpg

from app.collector.gbfs_client import GBFSClient
from app.collector.snapshot_collector import collect_snapshots
from app.collector.station_sync import sync_stations

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="session")]


@pytest_asyncio.fixture(loop_scope="session")
async def gbfs_client() -> GBFSClient:
    return GBFSClient(base_url="https://test.example.com")


def _make_station_info_response(stations: list[dict]) -> dict:
    return {"data": {"stations": stations}}


def _make_station_status_response(stations: list[dict]) -> dict:
    return {"data": {"stations": stations}}


STATION_A = {
    "station_id": "100",
    "name": "Station Alpha",
    "address": "Alpha Street 1",
    "lat": 54.35,
    "lon": 18.60,
    "capacity": 20,
    "is_virtual_station": False,
}

STATION_B = {
    "station_id": "200",
    "name": "Station Beta",
    "address": "Beta Street 2",
    "lat": 54.36,
    "lon": 18.61,
    "capacity": 15,
    "is_virtual_station": True,
}

STATION_C = {
    "station_id": "300",
    "name": "Station Gamma",
    "address": "Gamma Street 3",
    "lat": 54.37,
    "lon": 18.62,
    "capacity": 10,
    "is_virtual_station": False,
}

STATUS_A = {
    "station_id": "100",
    "num_bikes_available": 5,
    "num_docks_available": 15,
    "vehicle_types_available": [
        {"vehicle_type_id": "bike", "count": 3},
        {"vehicle_type_id": "ebike", "count": 2},
    ],
    "is_installed": True,
    "is_renting": True,
    "is_returning": True,
}

STATUS_B = {
    "station_id": "200",
    "num_bikes_available": 0,
    "num_docks_available": 15,
    "vehicle_types_available": [
        {"vehicle_type_id": "bike", "count": 0},
        {"vehicle_type_id": "ebike", "count": 0},
    ],
    "is_installed": True,
    "is_renting": False,
    "is_returning": True,
}


def _mock_transport(
    station_info: dict | None = None,
    station_status: dict | None = None,
) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if "station_information" in str(request.url) and station_info is not None:
            return httpx.Response(200, json=station_info)
        if "station_status" in str(request.url) and station_status is not None:
            return httpx.Response(200, json=station_status)
        return httpx.Response(404)

    return httpx.MockTransport(handler)


@pytest.fixture
def patch_httpx(monkeypatch: pytest.MonkeyPatch):  # type: ignore[no-untyped-def]
    def _patch(transport: httpx.MockTransport) -> None:
        original_init = httpx.AsyncClient.__init__

        def patched_init(self: Any, **kwargs: Any) -> None:
            kwargs["transport"] = transport
            original_init(self, **kwargs)

        monkeypatch.setattr(httpx.AsyncClient, "__init__", patched_init)

    return _patch


async def test_sync_stations_inserts_new_stations(
    db_pool: asyncpg.Pool,
    gbfs_client: GBFSClient,
    patch_httpx: Any,
) -> None:
    info_payload = _make_station_info_response([STATION_A, STATION_B])
    transport = _mock_transport(station_info=info_payload)
    patch_httpx(transport)

    count = await sync_stations(db_pool, gbfs_client)
    assert count == 2

    async with db_pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT station_id, name, address, lat, lon, capacity, is_virtual, is_active "
            "FROM stations ORDER BY station_id"
        )

    assert len(rows) == 2

    a = rows[0]
    assert a["station_id"] == "100"
    assert a["name"] == "Station Alpha"
    assert a["address"] == "Alpha Street 1"
    assert a["lat"] == pytest.approx(54.35)
    assert a["lon"] == pytest.approx(18.60)
    assert a["capacity"] == 20
    assert a["is_virtual"] is False
    assert a["is_active"] is True

    b = rows[1]
    assert b["station_id"] == "200"
    assert b["name"] == "Station Beta"
    assert b["is_virtual"] is True
    assert b["is_active"] is True


async def test_sync_stations_updates_existing(
    db_pool: asyncpg.Pool,
    gbfs_client: GBFSClient,
    patch_httpx: Any,
) -> None:
    async with db_pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO stations (station_id, name, address, lat, lon, capacity, is_virtual, is_active)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """,
            "100",
            "Old Name",
            "Old Address",
            54.35,
            18.60,
            20,
            False,
            True,
        )

    updated_station = {**STATION_A, "address": "New Alpha Street 99", "name": "Station Alpha Updated"}
    info_payload = _make_station_info_response([updated_station])
    transport = _mock_transport(station_info=info_payload)
    patch_httpx(transport)

    count = await sync_stations(db_pool, gbfs_client)
    assert count == 1

    async with db_pool.acquire() as conn:
        rows = await conn.fetch("SELECT station_id, name, address FROM stations")

    assert len(rows) == 1
    assert rows[0]["name"] == "Station Alpha Updated"
    assert rows[0]["address"] == "New Alpha Street 99"


async def test_sync_stations_deactivates_missing(
    db_pool: asyncpg.Pool,
    gbfs_client: GBFSClient,
    patch_httpx: Any,
) -> None:
    async with db_pool.acquire() as conn:
        for st in [STATION_A, STATION_B, STATION_C]:
            await conn.execute(
                """
                INSERT INTO stations (station_id, name, address, lat, lon, capacity, is_virtual, is_active)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """,
                st["station_id"],
                st["name"],
                st["address"],
                st["lat"],
                st["lon"],
                st["capacity"],
                st["is_virtual_station"],
                True,
            )

    info_payload = _make_station_info_response([STATION_A, STATION_B])
    transport = _mock_transport(station_info=info_payload)
    patch_httpx(transport)

    await sync_stations(db_pool, gbfs_client)

    async with db_pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT station_id, is_active FROM stations ORDER BY station_id"
        )

    assert len(rows) == 3
    assert rows[0]["station_id"] == "100"
    assert rows[0]["is_active"] is True
    assert rows[1]["station_id"] == "200"
    assert rows[1]["is_active"] is True
    assert rows[2]["station_id"] == "300"
    assert rows[2]["is_active"] is False


async def test_collect_snapshots_persists_to_db(
    db_pool: asyncpg.Pool,
    gbfs_client: GBFSClient,
    patch_httpx: Any,
) -> None:
    async with db_pool.acquire() as conn:
        for st in [STATION_A, STATION_B]:
            await conn.execute(
                """
                INSERT INTO stations (station_id, name, address, lat, lon, capacity, is_virtual, is_active)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """,
                st["station_id"],
                st["name"],
                st["address"],
                st["lat"],
                st["lon"],
                st["capacity"],
                st["is_virtual_station"],
                True,
            )

    status_payload = _make_station_status_response([STATUS_A, STATUS_B])
    transport = _mock_transport(station_status=status_payload)
    patch_httpx(transport)

    count = await collect_snapshots(db_pool, gbfs_client)
    assert count == 2

    async with db_pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT station_id, bikes_available, ebikes_available, docks_available, "
            "is_installed, is_renting, is_returning "
            "FROM snapshots ORDER BY station_id"
        )

    assert len(rows) == 2

    a = rows[0]
    assert a["station_id"] == "100"
    assert a["bikes_available"] == 3
    assert a["ebikes_available"] == 2
    assert a["docks_available"] == 15
    assert a["is_installed"] is True
    assert a["is_renting"] is True
    assert a["is_returning"] is True

    b = rows[1]
    assert b["station_id"] == "200"
    assert b["bikes_available"] == 0
    assert b["ebikes_available"] == 0
    assert b["docks_available"] == 15
    assert b["is_renting"] is False


async def test_collect_snapshots_skips_inactive_stations(
    db_pool: asyncpg.Pool,
    gbfs_client: GBFSClient,
    patch_httpx: Any,
) -> None:
    async with db_pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO stations (station_id, name, address, lat, lon, capacity, is_virtual, is_active)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """,
            "100",
            "Active Station",
            "Street 1",
            54.35,
            18.60,
            20,
            False,
            True,
        )
        await conn.execute(
            """
            INSERT INTO stations (station_id, name, address, lat, lon, capacity, is_virtual, is_active)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """,
            "200",
            "Inactive Station",
            "Street 2",
            54.36,
            18.61,
            15,
            True,
            False,
        )

    status_payload = _make_station_status_response([STATUS_A, STATUS_B])
    transport = _mock_transport(station_status=status_payload)
    patch_httpx(transport)

    count = await collect_snapshots(db_pool, gbfs_client)
    assert count == 1

    async with db_pool.acquire() as conn:
        rows = await conn.fetch("SELECT station_id FROM snapshots")

    assert len(rows) == 1
    assert rows[0]["station_id"] == "100"

"""API contract shape validation.

Asserts that backend responses contain the exact fields the frontend TypeScript
interfaces expect (frontend/src/api/stations.ts). Catches field renames, removals,
or type changes that would silently break the frontend.
"""
from __future__ import annotations

from datetime import time
from typing import Any

import pytest
from httpx import AsyncClient

from tests.conftest import insert_test_snapshots

pytestmark = [pytest.mark.asyncio(loop_scope="session"), pytest.mark.integration]

_STATION_FIELDS: dict[str, Any] = {
    "station_id": str,
    "name": str,
    "address": (str, type(None)),
    "lat": float,
    "lon": float,
    "capacity": (int, type(None)),
}

_AVAILABILITY_SLOT_FIELDS: dict[str, Any] = {
    "day_of_week": int,
    "time_slot": str,
    "avg_bikes": float,
    "avg_ebikes": float,
    "sample_count": int,
    "reliability_label": str,
}

_STATION_DETAIL_FIELDS: dict[str, Any] = {
    **_STATION_FIELDS,
    "availability": list,
}

_NEARBY_STATION_FIELDS: dict[str, Any] = {
    **_STATION_FIELDS,
    "distance_m": int,
}

_GEOCODE_FIELDS: dict[str, Any] = {
    "lat": float,
    "lon": float,
    "display_name": str,
}


def _assert_fields(obj: dict, expected: dict[str, Any], label: str = "") -> None:
    missing = expected.keys() - obj.keys()
    assert not missing, f"{label}: missing fields {missing}"
    for field, expected_type in expected.items():
        assert isinstance(obj[field], expected_type), (
            f"{label}.{field}: expected {expected_type}, got {type(obj[field]).__name__!r} "
            f"(value: {obj[field]!r})"
        )


async def test_stations_list_contract(api_client: AsyncClient, db_pool) -> None:
    async with db_pool.acquire() as conn:
        await insert_test_snapshots(conn, "contract-list-001", [], is_active=True)

    resp = await api_client.get("/api/v1/stations")
    assert resp.status_code == 200
    stations = resp.json()
    assert isinstance(stations, list)
    assert len(stations) >= 1

    target = next((s for s in stations if s.get("station_id") == "contract-list-001"), None)
    assert target is not None, "Seeded station missing from response"
    _assert_fields(target, _STATION_FIELDS, "StationResponse")


async def test_station_detail_contract(api_client: AsyncClient, db_pool) -> None:
    station_id = "contract-detail-001"
    async with db_pool.acquire() as conn:
        await insert_test_snapshots(conn, station_id, [], is_active=True)
        await conn.execute(
            "INSERT INTO station_availability "
            "(station_id, day_of_week, time_slot, avg_bikes, avg_ebikes, sample_count) "
            "VALUES ($1, $2, $3, $4, $5, $6)",
            station_id, 0, time(8, 0), 3.0, 1.0, 5,
        )

    resp = await api_client.get(f"/api/v1/stations/{station_id}")
    assert resp.status_code == 200
    data = resp.json()

    _assert_fields(data, _STATION_DETAIL_FIELDS, "StationDetailResponse")
    assert len(data["availability"]) >= 1
    _assert_fields(data["availability"][0], _AVAILABILITY_SLOT_FIELDS, "AvailabilitySlot")


async def test_nearby_stations_contract(api_client: AsyncClient, db_pool) -> None:
    async with db_pool.acquire() as conn:
        await insert_test_snapshots(
            conn, "contract-nearby-001", [], lat=54.35, lon=18.65, is_active=True
        )

    resp = await api_client.get("/api/v1/stations/nearby?lat=54.35&lon=18.65&limit=5")
    assert resp.status_code == 200
    stations = resp.json()
    assert isinstance(stations, list)

    target = next((s for s in stations if s.get("station_id") == "contract-nearby-001"), None)
    assert target is not None, "Seeded nearby station missing from response"
    _assert_fields(target, _NEARBY_STATION_FIELDS, "NearbyStationResponse")


async def test_geocode_contract(api_client: AsyncClient, mock_nominatim: None) -> None:
    resp = await api_client.get("/api/v1/geocode?q=Gdańsk")
    assert resp.status_code == 200
    data = resp.json()

    _assert_fields(data, _GEOCODE_FIELDS, "GeocodeResponse")

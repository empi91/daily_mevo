from __future__ import annotations

import math
from datetime import time

import pytest
from httpx import AsyncClient

from app.config import settings
from tests.conftest import insert_test_snapshots

pytestmark = [pytest.mark.asyncio(loop_scope="session"), pytest.mark.integration]


def _scos_dist(lat1: float, lon1: float, lat2: float, lon2: float) -> int:
    """Spherical law of cosines distance in metres — mirrors stations.py SQL formula."""
    r = 6371000
    la1, lo1, la2, lo2 = map(math.radians, [lat1, lon1, lat2, lon2])
    return int(
        r * math.acos(min(1.0, math.cos(la1) * math.cos(la2) * math.cos(lo2 - lo1) + math.sin(la1) * math.sin(la2)))
    )


async def test_list_stations_returns_active_only(
    api_client: AsyncClient, db_pool
) -> None:
    async with db_pool.acquire() as conn:
        await insert_test_snapshots(conn, "active-001", [], is_active=True)
        await insert_test_snapshots(conn, "inactive-001", [], is_active=False)

    resp = await api_client.get("/api/v1/stations")
    assert resp.status_code == 200
    stations = resp.json()
    station_ids = [s["station_id"] for s in stations]
    assert "active-001" in station_ids
    assert "inactive-001" not in station_ids

    active = next(s for s in stations if s["station_id"] == "active-001")
    assert active["name"] == "Test Station active-001"
    assert active["lat"] == pytest.approx(54.35)
    assert active["lon"] == pytest.approx(18.65)
    assert active["capacity"] == 20


async def test_get_station_returns_availability(
    api_client: AsyncClient, db_pool
) -> None:
    station_id = "avail-detail-001"
    async with db_pool.acquire() as conn:
        await insert_test_snapshots(conn, station_id, [])
        await conn.execute(
            "INSERT INTO station_availability "
            "(station_id, day_of_week, time_slot, avg_bikes, avg_ebikes, sample_count) "
            "VALUES ($1, $2, $3, $4, $5, $6)",
            station_id, 1, time(8, 0), 3.5, 1.5, 10,
        )

    resp = await api_client.get(f"/api/v1/stations/{station_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["station_id"] == station_id
    assert len(data["availability"]) == 1
    slot = data["availability"][0]
    assert slot["day_of_week"] == 1
    assert slot["time_slot"] == "08:00"
    assert slot["avg_bikes"] == pytest.approx(3.5)
    assert slot["avg_ebikes"] == pytest.approx(1.5)
    assert slot["sample_count"] == 10


@pytest.mark.parametrize(
    "avg_bikes,avg_ebikes,sample_count,expected_label",
    [
        # sample_count < min_sample_count (1) → insufficient_data
        (3.0, 0.0, 0, "insufficient_data"),
        # avg_bikes + avg_ebikes >= reliability_threshold_reliable (6) → reliable
        (6.0, 0.0, 5, "reliable"),
        # avg_bikes + avg_ebikes >= reliability_threshold_uncertain (2), < reliable → uncertain
        (2.0, 0.0, 5, "uncertain"),
        # avg_bikes + avg_ebikes < reliability_threshold_uncertain → empty
        (1.9, 0.0, 5, "empty"),
        # both avg_bikes and avg_ebikes contribute to crossing reliable threshold
        (4.0, 2.0, 5, "reliable"),
    ],
)
async def test_reliability_label_at_boundaries(
    api_client: AsyncClient,
    db_pool,
    avg_bikes: float,
    avg_ebikes: float,
    sample_count: int,
    expected_label: str,
) -> None:
    assert settings.min_sample_count == 1
    assert settings.reliability_threshold_reliable == 6
    assert settings.reliability_threshold_uncertain == 2

    station_id = f"reliability-{expected_label}"
    async with db_pool.acquire() as conn:
        await insert_test_snapshots(conn, station_id, [])
        await conn.execute(
            "INSERT INTO station_availability "
            "(station_id, day_of_week, time_slot, avg_bikes, avg_ebikes, sample_count) "
            "VALUES ($1, $2, $3, $4, $5, $6)",
            station_id, 1, time(9, 0), avg_bikes, avg_ebikes, sample_count,
        )

    resp = await api_client.get(f"/api/v1/stations/{station_id}")
    assert resp.status_code == 200
    slot = resp.json()["availability"][0]
    assert slot["reliability_label"] == expected_label


async def test_get_station_not_found(api_client: AsyncClient) -> None:
    resp = await api_client.get("/api/v1/stations/nonexistent-station-id")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Station not found"


async def test_nearby_stations_distance_correct(
    api_client: AsyncClient, db_pool
) -> None:
    # Query point: Gdańsk Główny area
    query_lat, query_lon = 54.35, 18.65

    # Station A: same location as query — expected distance 0 m
    sta_a_lat, sta_a_lon = 54.35, 18.65
    # Station B: ~3.2 km away (pure longitude offset of 0.05°)
    sta_b_lat, sta_b_lon = 54.35, 18.70

    # Pre-computed using the same spherical law of cosines formula as stations.py SQL:
    # 6371000 * acos(LEAST(1.0, cos(r(lat1))*cos(r(lat2))*cos(r(lon2)-r(lon1))+sin(r(lat1))*sin(r(lat2))))::int
    expected_a = _scos_dist(query_lat, query_lon, sta_a_lat, sta_a_lon)  # 0
    expected_b = _scos_dist(query_lat, query_lon, sta_b_lat, sta_b_lon)  # ≈3241

    async with db_pool.acquire() as conn:
        await insert_test_snapshots(conn, "nearby-dist-a", [], lat=sta_a_lat, lon=sta_a_lon)
        await insert_test_snapshots(conn, "nearby-dist-b", [], lat=sta_b_lat, lon=sta_b_lon)

    resp = await api_client.get(
        "/api/v1/stations/nearby",
        params={"lat": query_lat, "lon": query_lon, "limit": 10},
    )
    assert resp.status_code == 200
    stations = {s["station_id"]: s["distance_m"] for s in resp.json()}

    assert pytest.approx(stations["nearby-dist-a"], abs=1) == expected_a
    assert pytest.approx(stations["nearby-dist-b"], abs=1) == expected_b


async def test_nearby_stations_sorted_and_limited(
    api_client: AsyncClient, db_pool
) -> None:
    # Three stations at different distances from query point (54.35, 18.65):
    # closest: same location (0 m), middle: ~1.3 km, farthest: ~5.6 km
    query_lat, query_lon = 54.35, 18.65

    async with db_pool.acquire() as conn:
        await insert_test_snapshots(conn, "sort-close", [], lat=54.35, lon=18.65)
        await insert_test_snapshots(conn, "sort-mid", [], lat=54.36, lon=18.66)
        await insert_test_snapshots(conn, "sort-far", [], lat=54.40, lon=18.65)

    resp = await api_client.get(
        "/api/v1/stations/nearby",
        params={"lat": query_lat, "lon": query_lon, "limit": 10},
    )
    assert resp.status_code == 200
    results = resp.json()
    distances = [s["distance_m"] for s in results]
    assert distances == sorted(distances), "Nearby stations not sorted by distance"

    resp2 = await api_client.get(
        "/api/v1/stations/nearby",
        params={"lat": query_lat, "lon": query_lon, "limit": 2},
    )
    assert resp2.status_code == 200
    assert len(resp2.json()) == 2


async def test_get_station_empty_availability(
    api_client: AsyncClient, db_pool
) -> None:
    station_id = "no-avail-001"
    async with db_pool.acquire() as conn:
        await insert_test_snapshots(conn, station_id, [])

    resp = await api_client.get(f"/api/v1/stations/{station_id}")
    assert resp.status_code == 200
    assert resp.json()["availability"] == []


@pytest.mark.parametrize(
    "station_id",
    [
        "a" * 1000,
        "'; DROP TABLE stations; --",
        "<img src=x onerror=alert(1)>",
        "‮test‮",
    ],
    ids=["very_long", "sql_injection", "html_xss", "unicode_rtl"],
)
async def test_station_id_adversarial_input(
    api_client: AsyncClient, station_id: str
) -> None:
    resp = await api_client.get(f"/api/v1/stations/{station_id}")
    assert resp.status_code == 404, f"Expected 404, got {resp.status_code} for {station_id!r}"


@pytest.mark.parametrize(
    "params",
    [
        {"lat": "not_a_number", "lon": "18.65"},
        {"lat": "54.35", "lon": "not_a_number"},
        {"lat": "54.35", "lon": "18.65", "limit": "0"},
        {"lat": "54.35", "lon": "18.65", "limit": "21"},
    ],
    ids=["non_numeric_lat", "non_numeric_lon", "limit_zero", "limit_over_max"],
)
async def test_nearby_rejects_invalid_params(
    api_client: AsyncClient, params: dict
) -> None:
    resp = await api_client.get("/api/v1/stations/nearby", params=params)
    assert resp.status_code == 422


async def test_health_returns_ok(api_client: AsyncClient) -> None:
    resp = await api_client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    for key in ("status", "version", "database", "collector", "data_freshness"):
        assert key in data, f"Missing key: {key}"
    assert data["status"] == "ok"

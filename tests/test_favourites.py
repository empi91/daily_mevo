from __future__ import annotations

from datetime import datetime, time, timezone
from zoneinfo import ZoneInfo

import asyncpg
import pytest
from httpx import AsyncClient

from tests.conftest import insert_test_snapshots
from tests.test_auth import _cookie_header, _register_and_login

pytestmark = [pytest.mark.asyncio(loop_scope="session"), pytest.mark.integration]

STATION_ID = "7694"
STATION_ID_2 = "7661"


async def _ensure_station(
    conn: asyncpg.Connection, station_id: str = STATION_ID
) -> None:
    await insert_test_snapshots(
        conn,
        station_id,
        [
            {
                "bikes_available": 3,
                "ebikes_available": 1,
                "docks_available": 6,
                "collected_at": datetime(2026, 1, 5, 10, 0, tzinfo=timezone.utc),
            }
        ],
        station_name=f"Test Station {station_id}",
    )


async def _insert_availability_for_current_slot(
    conn: asyncpg.Connection, station_id: str = STATION_ID
) -> None:
    now = datetime.now(ZoneInfo("Europe/Warsaw"))
    day_of_week = now.weekday()
    minute_slot = (now.minute // 15) * 15
    time_slot = time(now.hour, minute_slot)
    await conn.execute(
        """
        INSERT INTO station_availability (station_id, day_of_week, time_slot, avg_bikes, avg_ebikes, sample_count)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (station_id, day_of_week, time_slot) DO UPDATE
        SET avg_bikes = EXCLUDED.avg_bikes, avg_ebikes = EXCLUDED.avg_ebikes, sample_count = EXCLUDED.sample_count
        """,
        station_id,
        day_of_week,
        time_slot,
        5.0,
        2.0,
        100,
    )


async def test_add_favourite(api_client: AsyncClient, db_pool: asyncpg.Pool) -> None:
    async with db_pool.acquire() as conn:
        await _ensure_station(conn)
    cookie = await _register_and_login(api_client, email="fav-add@example.com")
    resp = await api_client.post(
        f"/api/v1/favourites/{STATION_ID}",
        headers=_cookie_header(cookie),
    )
    assert resp.status_code == 200


async def test_list_favourites_empty(
    api_client: AsyncClient, db_pool: asyncpg.Pool
) -> None:
    cookie = await _register_and_login(api_client, email="fav-empty@example.com")
    resp = await api_client.get(
        "/api/v1/favourites",
        headers=_cookie_header(cookie),
    )
    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_favourites_with_station(
    api_client: AsyncClient, db_pool: asyncpg.Pool
) -> None:
    async with db_pool.acquire() as conn:
        await _ensure_station(conn)
    cookie = await _register_and_login(api_client, email="fav-list@example.com")
    await api_client.post(
        f"/api/v1/favourites/{STATION_ID}",
        headers=_cookie_header(cookie),
    )
    resp = await api_client.get(
        "/api/v1/favourites",
        headers=_cookie_header(cookie),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["station_id"] == STATION_ID
    assert data[0]["name"] == f"Test Station {STATION_ID}"


async def test_list_favourites_with_availability(
    api_client: AsyncClient, db_pool: asyncpg.Pool
) -> None:
    async with db_pool.acquire() as conn:
        await _ensure_station(conn)
        await _insert_availability_for_current_slot(conn)
    cookie = await _register_and_login(api_client, email="fav-avail@example.com")
    await api_client.post(
        f"/api/v1/favourites/{STATION_ID}",
        headers=_cookie_header(cookie),
    )
    resp = await api_client.get(
        "/api/v1/favourites",
        headers=_cookie_header(cookie),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["avg_bikes"] == 5.0
    assert data[0]["avg_ebikes"] == 2.0
    assert data[0]["reliability_label"] is not None


async def test_list_favourites_no_availability_data(
    api_client: AsyncClient, db_pool: asyncpg.Pool
) -> None:
    async with db_pool.acquire() as conn:
        await _ensure_station(conn, STATION_ID_2)
    cookie = await _register_and_login(api_client, email="fav-noavail@example.com")
    await api_client.post(
        f"/api/v1/favourites/{STATION_ID_2}",
        headers=_cookie_header(cookie),
    )
    resp = await api_client.get(
        "/api/v1/favourites",
        headers=_cookie_header(cookie),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["avg_bikes"] is None
    assert data[0]["avg_ebikes"] is None
    assert data[0]["reliability_label"] is None


async def test_remove_favourite(api_client: AsyncClient, db_pool: asyncpg.Pool) -> None:
    async with db_pool.acquire() as conn:
        await _ensure_station(conn)
    cookie = await _register_and_login(api_client, email="fav-remove@example.com")
    await api_client.post(
        f"/api/v1/favourites/{STATION_ID}",
        headers=_cookie_header(cookie),
    )
    del_resp = await api_client.delete(
        f"/api/v1/favourites/{STATION_ID}",
        headers=_cookie_header(cookie),
    )
    assert del_resp.status_code == 204
    list_resp = await api_client.get(
        "/api/v1/favourites",
        headers=_cookie_header(cookie),
    )
    assert list_resp.json() == []


async def test_add_favourite_idempotent(
    api_client: AsyncClient, db_pool: asyncpg.Pool
) -> None:
    async with db_pool.acquire() as conn:
        await _ensure_station(conn)
    cookie = await _register_and_login(api_client, email="fav-idem@example.com")
    resp1 = await api_client.post(
        f"/api/v1/favourites/{STATION_ID}",
        headers=_cookie_header(cookie),
    )
    assert resp1.status_code == 200
    resp2 = await api_client.post(
        f"/api/v1/favourites/{STATION_ID}",
        headers=_cookie_header(cookie),
    )
    assert resp2.status_code == 200
    list_resp = await api_client.get(
        "/api/v1/favourites",
        headers=_cookie_header(cookie),
    )
    assert len(list_resp.json()) == 1


async def test_remove_nonexistent_favourite(
    api_client: AsyncClient, db_pool: asyncpg.Pool
) -> None:
    cookie = await _register_and_login(api_client, email="fav-nonexist@example.com")
    resp = await api_client.delete(
        f"/api/v1/favourites/{STATION_ID}",
        headers=_cookie_header(cookie),
    )
    assert resp.status_code == 204


async def test_add_favourite_station_not_found(
    api_client: AsyncClient, db_pool: asyncpg.Pool
) -> None:
    cookie = await _register_and_login(api_client, email="fav-notfound@example.com")
    resp = await api_client.post(
        "/api/v1/favourites/NONEXISTENT_STATION",
        headers=_cookie_header(cookie),
    )
    assert resp.status_code == 404


async def test_unauthenticated_access(api_client: AsyncClient) -> None:
    get_resp = await api_client.get("/api/v1/favourites")
    assert get_resp.status_code == 401

    post_resp = await api_client.post(f"/api/v1/favourites/{STATION_ID}")
    assert post_resp.status_code == 401

    del_resp = await api_client.delete(f"/api/v1/favourites/{STATION_ID}")
    assert del_resp.status_code == 401

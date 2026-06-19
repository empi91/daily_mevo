from __future__ import annotations

import os
import time

import httpx
import pytest

pytestmark = [pytest.mark.smoke, pytest.mark.asyncio(loop_scope="session")]

BASE_URL = os.environ.get("MEVO_SMOKE_BASE_URL", "http://localhost:8000")


def _server_reachable() -> bool:
    try:
        resp = httpx.get(f"{BASE_URL}/health", timeout=3.0)
        return resp.status_code == 200
    except (httpx.ConnectError, httpx.TimeoutException):
        return False


@pytest.fixture(autouse=True)
def _skip_if_no_server() -> None:
    if not _server_reachable():
        pytest.skip(f"Smoke server not reachable at {BASE_URL}")


@pytest.fixture
def smoke_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(base_url=BASE_URL, timeout=5.0)


async def test_smoke_health(smoke_client: httpx.AsyncClient) -> None:
    resp = await smoke_client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"


async def test_smoke_register(smoke_client: httpx.AsyncClient) -> None:
    email = f"smoke-{int(time.time())}@example.com"
    resp = await smoke_client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "smokepass123"},
    )
    assert resp.status_code != 500, f"Register returned 500: {resp.text}"


async def test_smoke_stations(smoke_client: httpx.AsyncClient) -> None:
    resp = await smoke_client.get("/api/v1/stations")
    assert resp.status_code == 200

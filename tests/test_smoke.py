from __future__ import annotations

import os
import time

import httpx
import pytest

pytestmark = [pytest.mark.smoke, pytest.mark.asyncio(loop_scope="session")]

BASE_URL = os.environ.get("MEVO_SMOKE_BASE_URL", "http://localhost:8000")

# Shared state across auth-flow tests (module-level, set by test_smoke_login)
_smoke_email: str = ""
_smoke_cookie: str = ""


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
    assert resp.status_code == 201, f"Register returned {resp.status_code}: {resp.text}"
    data = resp.json()
    assert "id" in data, f"Register response missing 'id': {data}"
    assert "email" in data, f"Register response missing 'email': {data}"


async def test_smoke_login(smoke_client: httpx.AsyncClient) -> None:
    global _smoke_email, _smoke_cookie
    _smoke_email = f"smoke-login-{int(time.time())}@example.com"
    reg = await smoke_client.post(
        "/api/v1/auth/register",
        json={"email": _smoke_email, "password": "smokepass123"},
    )
    assert reg.status_code == 201, f"Pre-login register failed: {reg.text}"

    resp = await smoke_client.post(
        "/api/v1/auth/cookie/login",
        data={"username": _smoke_email, "password": "smokepass123"},
    )
    assert resp.status_code == 204, f"Login returned {resp.status_code}: {resp.text}"
    set_cookie = resp.headers.get("set-cookie", "")
    assert "fastapiusersauth" in set_cookie, (
        f"Login response missing fastapiusersauth cookie: {set_cookie}"
    )
    # Extract raw cookie value for subsequent requests
    _smoke_cookie = set_cookie.split(";")[0]


async def test_smoke_authenticated_access(smoke_client: httpx.AsyncClient) -> None:
    if not _smoke_cookie:
        pytest.skip("No cookie from test_smoke_login — run tests in order")
    resp = await smoke_client.get(
        "/api/v1/users/me",
        headers={"Cookie": _smoke_cookie},
    )
    assert resp.status_code == 200, (
        f"/users/me returned {resp.status_code}: {resp.text}"
    )
    data = resp.json()
    assert "email" in data, f"/users/me response missing 'email': {data}"
    assert data["email"] == _smoke_email


async def test_smoke_logout(smoke_client: httpx.AsyncClient) -> None:
    if not _smoke_cookie:
        pytest.skip("No cookie from test_smoke_login — run tests in order")
    resp = await smoke_client.post(
        "/api/v1/auth/cookie/logout",
        headers={"Cookie": _smoke_cookie},
    )
    assert resp.status_code == 204, f"Logout returned {resp.status_code}: {resp.text}"


async def test_smoke_protected_after_logout(smoke_client: httpx.AsyncClient) -> None:
    resp = await smoke_client.get("/api/v1/users/me")
    assert resp.status_code == 401, (
        f"/users/me without cookie returned {resp.status_code} (expected 401): {resp.text}"
    )


async def test_smoke_stations(smoke_client: httpx.AsyncClient) -> None:
    resp = await smoke_client.get("/api/v1/stations")
    assert resp.status_code == 200


async def test_smoke_station_detail(smoke_client: httpx.AsyncClient) -> None:
    list_resp = await smoke_client.get("/api/v1/stations")
    assert list_resp.status_code == 200, (
        f"Stations list returned {list_resp.status_code}"
    )
    stations = list_resp.json()
    assert len(stations) > 0, "No stations returned — cannot test station detail"
    station_id = stations[0]["station_id"]

    resp = await smoke_client.get(f"/api/v1/stations/{station_id}")
    assert resp.status_code == 200, (
        f"Station detail returned {resp.status_code}: {resp.text}"
    )
    data = resp.json()
    assert "station_id" in data, f"Station detail missing 'station_id': {data}"
    assert "name" in data, f"Station detail missing 'name': {data}"
    assert "availability" in data, f"Station detail missing 'availability': {data}"


async def test_smoke_cors_preflight(smoke_client: httpx.AsyncClient) -> None:
    resp = await smoke_client.options(
        "/api/v1/stations",
        headers={
            "Origin": "https://dailymevo.pl",
            "Access-Control-Request-Method": "GET",
        },
    )
    acao = resp.headers.get("access-control-allow-origin", "")
    acac = resp.headers.get("access-control-allow-credentials", "")
    assert "dailymevo.pl" in acao, (
        f"CORS allow-origin missing dailymevo.pl: '{acao}' (status {resp.status_code})"
    )
    assert acac.lower() == "true", f"CORS allow-credentials not 'true': '{acac}'"

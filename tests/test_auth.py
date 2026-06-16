import time
import uuid

import jwt
import pytest
from httpx import AsyncClient

from app.config import settings

pytestmark = [pytest.mark.asyncio(loop_scope="session"), pytest.mark.integration]

TEST_EMAIL = "authtest@example.com"
TEST_PASSWORD = "securepass123"


def _cookie_header(token: str) -> dict[str, str]:
    return {"Cookie": f"fastapiusersauth={token}"}


async def _register_and_login(
    api_client: AsyncClient, email: str = TEST_EMAIL, password: str = TEST_PASSWORD
) -> str:
    await api_client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password},
    )
    login_resp = await api_client.post(
        "/api/v1/auth/cookie/login",
        data={"username": email, "password": password},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    cookie = login_resp.cookies.get("fastapiusersauth")
    assert cookie is not None
    return cookie


async def test_register_new_user(api_client: AsyncClient) -> None:
    resp = await api_client.post(
        "/api/v1/auth/register",
        json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["email"] == TEST_EMAIL
    assert "id" in data


async def test_register_duplicate_email(api_client: AsyncClient) -> None:
    email = "duplicate@example.com"
    await api_client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": TEST_PASSWORD},
    )
    resp = await api_client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": TEST_PASSWORD},
    )
    assert resp.status_code == 400
    assert "REGISTER_USER_ALREADY_EXISTS" in resp.json()["detail"]


async def test_register_short_password(api_client: AsyncClient) -> None:
    resp = await api_client.post(
        "/api/v1/auth/register",
        json={"email": "short@example.com", "password": "abc"},
    )
    assert resp.status_code == 400


async def test_login_correct_credentials(api_client: AsyncClient) -> None:
    await api_client.post(
        "/api/v1/auth/register",
        json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
    )
    resp = await api_client.post(
        "/api/v1/auth/cookie/login",
        data={"username": TEST_EMAIL, "password": TEST_PASSWORD},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert resp.status_code == 204
    assert "fastapiusersauth" in resp.cookies


async def test_login_wrong_password(api_client: AsyncClient) -> None:
    await api_client.post(
        "/api/v1/auth/register",
        json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
    )
    resp = await api_client.post(
        "/api/v1/auth/cookie/login",
        data={"username": TEST_EMAIL, "password": "wrongwrong"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert resp.status_code == 400
    assert "LOGIN_BAD_CREDENTIALS" in resp.json()["detail"]


async def test_login_nonexistent_email(api_client: AsyncClient) -> None:
    resp = await api_client.post(
        "/api/v1/auth/cookie/login",
        data={"username": "nobody@example.com", "password": "whatever1"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert resp.status_code == 400


async def test_me_with_cookie(api_client: AsyncClient) -> None:
    cookie = await _register_and_login(api_client)
    me_resp = await api_client.get(
        "/api/v1/users/me",
        headers=_cookie_header(cookie),
    )
    assert me_resp.status_code == 200
    assert me_resp.json()["email"] == TEST_EMAIL


async def test_me_without_cookie(api_client: AsyncClient) -> None:
    resp = await api_client.get("/api/v1/users/me")
    assert resp.status_code == 401


async def test_logout(api_client: AsyncClient) -> None:
    cookie = await _register_and_login(api_client)
    logout_resp = await api_client.post(
        "/api/v1/auth/cookie/logout",
        headers=_cookie_header(cookie),
    )
    assert logout_resp.status_code == 204


async def test_me_after_logout(api_client: AsyncClient) -> None:
    cookie = await _register_and_login(api_client)
    logout_resp = await api_client.post(
        "/api/v1/auth/cookie/logout",
        headers=_cookie_header(cookie),
    )
    set_cookie = logout_resp.headers.get("set-cookie", "")
    assert 'fastapiusersauth=""' in set_cookie or "Max-Age=0" in set_cookie

    me_resp = await api_client.get("/api/v1/users/me")
    assert me_resp.status_code == 401


async def test_cookie_persists_across_requests(api_client: AsyncClient) -> None:
    email = "persist@example.com"
    cookie = await _register_and_login(api_client, email=email)

    me_resp_1 = await api_client.get(
        "/api/v1/users/me",
        headers=_cookie_header(cookie),
    )
    assert me_resp_1.status_code == 200
    assert me_resp_1.json()["email"] == email

    me_resp_2 = await api_client.get(
        "/api/v1/users/me",
        headers=_cookie_header(cookie),
    )
    assert me_resp_2.status_code == 200
    assert me_resp_2.json()["email"] == email


async def test_expired_jwt_returns_401(api_client: AsyncClient) -> None:
    payload = {
        "sub": str(uuid.uuid4()),
        "aud": "fastapi-users:auth",
        "exp": int(time.time()) - 3600,
    }
    expired_token = jwt.encode(payload, settings.jwt_secret, algorithm="HS256")

    resp = await api_client.get(
        "/api/v1/users/me",
        headers=_cookie_header(expired_token),
    )
    assert resp.status_code == 401


async def test_cors_preflight_allows_configured_origin(
    api_client: AsyncClient,
) -> None:
    resp = await api_client.options(
        "/api/v1/auth/cookie/login",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert resp.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert resp.headers.get("access-control-allow-credentials") == "true"

    resp_bad = await api_client.options(
        "/api/v1/auth/cookie/login",
        headers={
            "Origin": "http://evil.example.com",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert resp_bad.headers.get("access-control-allow-origin") != "http://evil.example.com"

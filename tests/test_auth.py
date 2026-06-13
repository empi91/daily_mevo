import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import create_async_engine

from app.auth.models import Base
from app.config import settings
from app.main import app

pytestmark = pytest.mark.asyncio(loop_scope="module")

TEST_EMAIL = "authtest@example.com"
TEST_PASSWORD = "securepass123"


@pytest_asyncio.fixture(scope="module", loop_scope="module")
async def setup_db():
    if settings.environment != "development":
        pytest.skip("Auth tests only run in development environment")
    engine = create_async_engine(settings.database_url or "")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture(loop_scope="module")
async def client(setup_db):
    transport = ASGITransport(app=app)  # type: ignore[arg-type]
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


async def test_register_new_user(client: AsyncClient) -> None:
    resp = await client.post(
        "/api/v1/auth/register",
        json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["email"] == TEST_EMAIL
    assert "id" in data


async def test_register_duplicate_email(client: AsyncClient) -> None:
    email = "duplicate@example.com"
    await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": TEST_PASSWORD},
    )
    resp = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": TEST_PASSWORD},
    )
    assert resp.status_code == 400
    assert "REGISTER_USER_ALREADY_EXISTS" in resp.json()["detail"]


async def test_register_short_password(client: AsyncClient) -> None:
    resp = await client.post(
        "/api/v1/auth/register",
        json={"email": "short@example.com", "password": "abc"},
    )
    assert resp.status_code == 400


async def test_login_correct_credentials(client: AsyncClient) -> None:
    resp = await client.post(
        "/api/v1/auth/cookie/login",
        data={"username": TEST_EMAIL, "password": TEST_PASSWORD},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert resp.status_code == 204
    assert "fastapiusersauth" in resp.cookies


async def test_login_wrong_password(client: AsyncClient) -> None:
    resp = await client.post(
        "/api/v1/auth/cookie/login",
        data={"username": TEST_EMAIL, "password": "wrongwrong"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert resp.status_code == 400
    assert "LOGIN_BAD_CREDENTIALS" in resp.json()["detail"]


async def test_login_nonexistent_email(client: AsyncClient) -> None:
    resp = await client.post(
        "/api/v1/auth/cookie/login",
        data={"username": "nobody@example.com", "password": "whatever1"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert resp.status_code == 400


async def test_me_with_cookie(client: AsyncClient) -> None:
    login_resp = await client.post(
        "/api/v1/auth/cookie/login",
        data={"username": TEST_EMAIL, "password": TEST_PASSWORD},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    cookie = login_resp.cookies.get("fastapiusersauth")
    assert cookie is not None

    me_resp = await client.get(
        "/api/v1/users/me",
        cookies={"fastapiusersauth": cookie},
    )
    assert me_resp.status_code == 200
    assert me_resp.json()["email"] == TEST_EMAIL


async def test_me_without_cookie(client: AsyncClient) -> None:
    resp = await client.get("/api/v1/users/me")
    assert resp.status_code == 401


async def test_logout(client: AsyncClient) -> None:
    login_resp = await client.post(
        "/api/v1/auth/cookie/login",
        data={"username": TEST_EMAIL, "password": TEST_PASSWORD},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    cookie = login_resp.cookies.get("fastapiusersauth")
    assert cookie is not None

    logout_resp = await client.post(
        "/api/v1/auth/cookie/logout",
        cookies={"fastapiusersauth": cookie},
    )
    assert logout_resp.status_code == 204


async def test_me_after_logout(client: AsyncClient) -> None:
    login_resp = await client.post(
        "/api/v1/auth/cookie/login",
        data={"username": TEST_EMAIL, "password": TEST_PASSWORD},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    cookie = login_resp.cookies.get("fastapiusersauth")
    assert cookie is not None

    logout_resp = await client.post(
        "/api/v1/auth/cookie/logout",
        cookies={"fastapiusersauth": cookie},
    )
    # Logout clears the cookie (max-age=0); the JWT itself stays valid
    # (stateless auth). Verify the Set-Cookie header instructs deletion.
    set_cookie = logout_resp.headers.get("set-cookie", "")
    assert 'fastapiusersauth=""' in set_cookie or "Max-Age=0" in set_cookie

    # Without cookie, /me returns 401
    me_resp = await client.get("/api/v1/users/me")
    assert me_resp.status_code == 401

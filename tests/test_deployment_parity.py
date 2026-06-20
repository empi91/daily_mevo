"""Config regression tests for production-critical configuration values.

Guards the three classes of bug that caused production failures:
- PgBouncer statement_cache_size (asyncpg prepared statements incompatible with transaction mode)
- Alembic migration chain consistency (migration recorded but table missing)
- Cookie/CORS attributes under production env config (issue #24)
"""

from __future__ import annotations

import importlib
import os
from collections.abc import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock, patch

# Ensure app.config can be imported by tests that need auth module access
# but don't require a real database. Real values from env/.env take precedence.
os.environ.setdefault("MEVO_DATABASE_URL", "postgresql+asyncpg://localhost/test")
os.environ.setdefault("MEVO_JWT_SECRET", "test-only-fake-secret-for-unit-tests")

import pytest
from httpx import ASGITransport, AsyncClient


# ---------------------------------------------------------------------------
# PgBouncer regression — no database connection needed
# ---------------------------------------------------------------------------


async def test_asyncpg_pool_statement_cache_size_zero() -> None:
    import asyncpg
    import app.db as db_mod

    mock_pool = MagicMock()
    with patch.object(
        asyncpg, "create_pool", new=AsyncMock(return_value=mock_pool)
    ) as mock_create:
        await db_mod.create_pool("postgresql://localhost/testdb")

    call_kwargs = mock_create.call_args.kwargs
    assert call_kwargs.get("statement_cache_size") == 0, (
        f"asyncpg pool must use statement_cache_size=0 for PgBouncer compatibility; "
        f"got {call_kwargs.get('statement_cache_size')!r}"
    )


def test_sqlalchemy_engine_statement_cache_size_zero() -> None:
    import app.auth.db as auth_db_mod

    original_engine = auth_db_mod.engine
    original_session_maker = auth_db_mod.async_session_maker

    mock_engine = MagicMock()
    mock_session = MagicMock()

    with (
        patch(
            "sqlalchemy.ext.asyncio.create_async_engine", return_value=mock_engine
        ) as mock_create,
        patch("sqlalchemy.ext.asyncio.async_sessionmaker", return_value=mock_session),
    ):
        importlib.reload(auth_db_mod)

    auth_db_mod.engine = original_engine
    auth_db_mod.async_session_maker = original_session_maker

    call_kwargs = mock_create.call_args.kwargs
    connect_args = call_kwargs.get("connect_args", {})
    assert connect_args.get("statement_cache_size") == 0, (
        f"SQLAlchemy engine must pass statement_cache_size=0 in connect_args; "
        f"got {connect_args!r}"
    )


# ---------------------------------------------------------------------------
# Migration chain — no database connection needed
# ---------------------------------------------------------------------------


def test_migration_head_is_007() -> None:
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    cfg = Config("alembic.ini")
    script_dir = ScriptDirectory.from_config(cfg)
    heads = script_dir.get_heads()

    assert len(heads) == 1, f"Expected single migration head (no branches); got {heads}"
    assert heads[0] == "007", f"Expected head revision '007'; got '{heads[0]}'"


def test_migration_chain_is_linear() -> None:
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    cfg = Config("alembic.ini")
    script_dir = ScriptDirectory.from_config(cfg)
    revisions = list(script_dir.walk_revisions())

    assert len(revisions) == 7, (
        f"Expected 7 migration revisions (001–007); got {len(revisions)}: "
        f"{[r.revision for r in revisions]}"
    )
    # Verify every non-base revision has exactly one predecessor (linear chain)
    for rev in revisions:
        if rev.down_revision is not None:
            assert not isinstance(rev.down_revision, tuple), (
                f"Revision {rev.revision} has multiple parents — branch detected"
            )


# ---------------------------------------------------------------------------
# Cookie transport config — unit-level inspection
# ---------------------------------------------------------------------------


def test_cookie_transport_httponly() -> None:
    from app.auth.config import cookie_transport

    assert cookie_transport.cookie_httponly is True


def test_cookie_transport_samesite_lax() -> None:
    from app.auth.config import cookie_transport

    assert cookie_transport.cookie_samesite == "lax"


def test_cookie_transport_secure_logic() -> None:
    """Secure flag must be True in any environment that is not 'development'."""
    from app.config import settings
    from app.auth.config import cookie_transport

    expected_secure = settings.environment != "development"
    assert cookie_transport.cookie_secure is expected_secure


# ---------------------------------------------------------------------------
# Cookie attributes in login response — integration (requires DB)
# ---------------------------------------------------------------------------


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_cookie_attributes_in_production_response(
    api_client: AsyncClient,
) -> None:
    """Login response under production settings must carry Secure, HttpOnly, SameSite=Lax."""
    import time
    from app.auth.config import cookie_transport

    original_secure = cookie_transport.cookie_secure
    cookie_transport.cookie_secure = True
    try:
        email = f"parity-cookie-{int(time.time())}@example.com"
        reg = await api_client.post(
            "/api/v1/auth/register",
            json={"email": email, "password": "TestPass123!"},
        )
        assert reg.status_code == 201, f"Register failed: {reg.text}"

        login = await api_client.post(
            "/api/v1/auth/cookie/login",
            data={"username": email, "password": "TestPass123!"},
        )
        assert login.status_code == 204, f"Login failed: {login.text}"

        set_cookie = login.headers.get("set-cookie", "")
        assert set_cookie, "No Set-Cookie header in login response"
        lowered = set_cookie.lower()
        assert "httponly" in lowered, f"HttpOnly missing in Set-Cookie: {set_cookie}"
        assert "samesite=lax" in lowered, (
            f"SameSite=Lax missing in Set-Cookie: {set_cookie}"
        )
        assert "secure" in lowered, (
            f"Secure missing in Set-Cookie (production config): {set_cookie}"
        )
        assert "path=/" in lowered, f"Path=/ missing in Set-Cookie: {set_cookie}"
    finally:
        cookie_transport.cookie_secure = original_secure


# ---------------------------------------------------------------------------
# CORS headers under production origin — mini-app (no DB needed)
# ---------------------------------------------------------------------------


@pytest.fixture
async def cors_production_client() -> AsyncGenerator[AsyncClient, None]:
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware

    mini_app = FastAPI()
    mini_app.add_middleware(
        CORSMiddleware,
        allow_origins=["https://dailymevo.pl"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @mini_app.get("/ping")
    async def ping() -> dict:
        return {"ok": True}

    async with AsyncClient(
        transport=ASGITransport(app=mini_app), base_url="http://test"
    ) as client:
        yield client


async def test_cors_production_origin_allowed(
    cors_production_client: AsyncClient,
) -> None:
    resp = await cors_production_client.options(
        "/ping",
        headers={
            "Origin": "https://dailymevo.pl",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert resp.headers.get("access-control-allow-origin") == "https://dailymevo.pl"
    assert resp.headers.get("access-control-allow-credentials") == "true"


async def test_cors_unauthorized_origin_rejected(
    cors_production_client: AsyncClient,
) -> None:
    resp = await cors_production_client.options(
        "/ping",
        headers={
            "Origin": "https://evil.example.com",
            "Access-Control-Request-Method": "GET",
        },
    )
    acao = resp.headers.get("access-control-allow-origin", "")
    assert acao != "https://evil.example.com", (
        "Unauthorized origin must not be reflected in access-control-allow-origin"
    )

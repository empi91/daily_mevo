from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
import asyncpg
import httpx


pytestmark = pytest.mark.integration


@pytest.mark.asyncio(loop_scope="session")
async def test_check_db_size_records_to_log(db_pool: asyncpg.Pool) -> None:
    from app.monitoring import check_db_size

    size_mb = await check_db_size(
        db_pool, ntfy_topic=None, warning_mb=400, critical_mb=450
    )

    assert size_mb > 0
    async with db_pool.acquire() as conn:
        count = await conn.fetchval("SELECT count(*) FROM db_size_log")
        assert count >= 1
        row = await conn.fetchrow(
            "SELECT size_bytes FROM db_size_log ORDER BY id DESC LIMIT 1"
        )
        assert row is not None
        assert row["size_bytes"] > 0


@pytest.mark.asyncio(loop_scope="session")
async def test_no_alert_below_warning(db_pool: asyncpg.Pool) -> None:
    from app.monitoring import check_db_size

    with patch("app.monitoring._send_ntfy_alert", new_callable=AsyncMock) as mock_alert:
        await check_db_size(
            db_pool, ntfy_topic="test-topic", warning_mb=999_999, critical_mb=999_999
        )
        mock_alert.assert_not_called()


@pytest.mark.asyncio(loop_scope="session")
async def test_no_alert_when_topic_none(db_pool: asyncpg.Pool) -> None:
    from app.monitoring import check_db_size

    with patch("app.monitoring._send_ntfy_alert", new_callable=AsyncMock) as mock_alert:
        await check_db_size(db_pool, ntfy_topic=None, warning_mb=0, critical_mb=0)
        mock_alert.assert_not_called()


@pytest.mark.asyncio(loop_scope="session")
async def test_warning_alert_sent(db_pool: asyncpg.Pool) -> None:
    from app.monitoring import check_db_size

    with patch("app.monitoring._send_ntfy_alert", new_callable=AsyncMock) as mock_alert:
        await check_db_size(
            db_pool, ntfy_topic="test-topic", warning_mb=0, critical_mb=999_999
        )
        mock_alert.assert_called_once()
        args = mock_alert.call_args
        assert args[0][0] == "test-topic"
        assert args[0][2] == 999_999


@pytest.mark.asyncio(loop_scope="session")
async def test_critical_alert_sent(db_pool: asyncpg.Pool) -> None:
    from app.monitoring import check_db_size

    with patch("app.monitoring._send_ntfy_alert", new_callable=AsyncMock) as mock_alert:
        await check_db_size(
            db_pool, ntfy_topic="test-topic", warning_mb=0, critical_mb=0
        )
        mock_alert.assert_called_once()
        args = mock_alert.call_args
        assert args[0][2] == 0


@pytest.mark.asyncio(loop_scope="session")
async def test_ntfy_failure_handled_gracefully(db_pool: asyncpg.Pool) -> None:
    from app.monitoring import _send_ntfy_alert

    with patch("app.monitoring.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.post.side_effect = httpx.RequestError("connection refused")
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client

        await _send_ntfy_alert("test-topic", 450.0, 450)

from __future__ import annotations

import pytest
from httpx import AsyncClient

pytestmark = [pytest.mark.asyncio(loop_scope="session"), pytest.mark.integration]


async def test_geocode_valid_query(
    api_client: AsyncClient, mock_nominatim: None
) -> None:
    resp = await api_client.get("/api/v1/geocode", params={"q": "Gdansk"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["lat"] == pytest.approx(54.35)
    assert data["lon"] == pytest.approx(18.65)
    assert data["display_name"] == "Gdańsk, PL"


@pytest.mark.parametrize(
    "query_input,expected_status",
    [
        ("x", 422),  # single char, below min_length=2
        ("'; DROP TABLE stations; --", None),  # SQL injection
        ("<script>alert('xss')</script>", None),  # HTML/script injection
        ("a" * 2000, None),  # very long string
        ("‮", 422),  # RTL override, single char
        ("ab‍", None),  # zero-width joiner (len >= 2)
        ("tèst", None),  # combining diacritical
        ("test\x00query", None),  # null byte
        ("   ", None),  # whitespace only, len >= 2
    ],
    ids=[
        "single_char",
        "sql_injection",
        "html_script",
        "very_long",
        "rtl_override",
        "zero_width_joiner",
        "combining_diacritical",
        "null_byte",
        "whitespace_only",
    ],
)
async def test_geocode_adversarial_input(
    api_client: AsyncClient,
    mock_nominatim: None,
    query_input: str,
    expected_status: int | None,
) -> None:
    resp = await api_client.get("/api/v1/geocode", params={"q": query_input})
    if expected_status is not None:
        assert resp.status_code == expected_status
    assert resp.status_code != 500, f"Got 500 for input: {query_input!r}"


async def test_geocode_service_error_returns_502(
    api_client: AsyncClient, mock_nominatim: None
) -> None:
    resp = await api_client.get("/api/v1/geocode", params={"q": "__error__"})
    assert resp.status_code == 502
    assert resp.json()["detail"] == "Geocoding service error"


async def test_geocode_network_error_returns_502(
    api_client: AsyncClient, mock_nominatim: None
) -> None:
    resp = await api_client.get("/api/v1/geocode", params={"q": "__network_error__"})
    assert resp.status_code == 502
    assert resp.json()["detail"] == "Geocoding service unavailable"

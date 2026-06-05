import httpx
import pytest

from app.collector.gbfs_client import GBFSClient
from app.collector.models import StationInfo, StationStatus


@pytest.mark.asyncio
async def test_fetch_station_info_parses_correctly(
    station_info_payload: dict,
) -> None:
    async def mock_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=station_info_payload)

    transport = httpx.MockTransport(mock_handler)

    async with httpx.AsyncClient(transport=transport) as http_client:
        resp = await http_client.get(
            "https://test.example.com/station_information.json"
        )
        data = resp.json()
        stations = [
            StationInfo.model_validate(s) for s in data["data"]["stations"]
        ]

    assert len(stations) == 2
    assert stations[0].station_id == "7694"
    assert stations[0].name == "GPG019"
    assert stations[0].lat == 54.27515
    assert stations[0].lon == 18.58503
    assert stations[0].capacity == 10
    assert stations[0].is_virtual_station is True
    assert stations[1].station_id == "7661"


@pytest.mark.asyncio
async def test_fetch_station_status_parses_correctly(
    station_status_payload: dict,
) -> None:
    data = station_status_payload
    statuses = [
        StationStatus.model_validate(s) for s in data["data"]["stations"]
    ]

    assert len(statuses) == 2

    s0 = statuses[0]
    assert s0.station_id == "7694"
    assert s0.bikes_count == 2
    assert s0.ebikes_count == 1
    assert s0.num_docks_available == 7
    assert s0.is_renting is True

    s1 = statuses[1]
    assert s1.station_id == "7661"
    assert s1.bikes_count == 0
    assert s1.ebikes_count == 0
    assert s1.is_renting is False


@pytest.mark.asyncio
async def test_fetch_station_info_returns_none_on_error() -> None:
    async def error_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    transport = httpx.MockTransport(error_handler)
    client = GBFSClient(base_url="https://test.example.com")

    class PatchedClient(httpx.AsyncClient):
        def __init__(self, **kwargs):  # type: ignore[no-untyped-def]
            kwargs["transport"] = transport
            super().__init__(**kwargs)

    old_client = httpx.AsyncClient
    httpx.AsyncClient = PatchedClient  # type: ignore[misc]
    try:
        result = await client.fetch_station_info()
    finally:
        httpx.AsyncClient = old_client  # type: ignore[misc]

    assert result is None

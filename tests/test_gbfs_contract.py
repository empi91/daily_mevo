from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.collector.models import StationInfo, StationStatus

FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture
def station_info_json() -> dict:  # type: ignore[type-arg]
    return json.loads((FIXTURES_DIR / "gbfs_station_information.json").read_text())  # type: ignore[no-any-return]


@pytest.fixture
def station_status_json() -> dict:  # type: ignore[type-arg]
    return json.loads((FIXTURES_DIR / "gbfs_station_status.json").read_text())  # type: ignore[no-any-return]


def test_station_info_fixture_parses_to_model(station_info_json: dict) -> None:
    stations_raw = station_info_json["data"]["stations"]
    stations = [StationInfo.model_validate(s) for s in stations_raw]

    assert len(stations) > 0
    for s in stations:
        assert s.station_id
        assert -90 <= s.lat <= 90
        assert -180 <= s.lon <= 180


def test_station_status_fixture_parses_to_model(station_status_json: dict) -> None:
    stations_raw = station_status_json["data"]["stations"]
    statuses = [StationStatus.model_validate(s) for s in stations_raw]

    assert len(statuses) > 0
    for s in statuses:
        assert s.station_id


def test_vehicle_types_available_contains_bike_types(
    station_status_json: dict,
) -> None:
    stations_raw = station_status_json["data"]["stations"]
    statuses = [StationStatus.model_validate(s) for s in stations_raw]

    vehicle_type_ids: set[str] = set()
    for s in statuses:
        for vt in s.vehicle_types_available:
            vehicle_type_ids.add(vt.vehicle_type_id)

    assert "bike" in vehicle_type_ids
    assert "ebike" in vehicle_type_ids


def test_station_status_computed_properties(station_status_json: dict) -> None:
    stations_raw = station_status_json["data"]["stations"]
    statuses = [StationStatus.model_validate(s) for s in stations_raw]

    for s in statuses:
        assert isinstance(s.bikes_count, int)
        assert s.bikes_count >= 0
        assert isinstance(s.ebikes_count, int)
        assert s.ebikes_count >= 0

        bike_vt = next(
            (vt for vt in s.vehicle_types_available if vt.vehicle_type_id == "bike"),
            None,
        )
        if bike_vt is not None:
            assert s.bikes_count == bike_vt.count
        else:
            assert s.bikes_count == s.num_bikes_available


def test_response_envelope_structure(
    station_info_json: dict, station_status_json: dict
) -> None:
    for payload in [station_info_json, station_status_json]:
        assert "data" in payload
        assert "stations" in payload["data"]
        assert isinstance(payload["data"]["stations"], list)
        assert len(payload["data"]["stations"]) > 0

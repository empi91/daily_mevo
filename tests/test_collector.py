from app.collector.models import StationStatus


def test_snapshot_row_generation(station_status_payload: dict) -> None:
    statuses = [
        StationStatus.model_validate(s)
        for s in station_status_payload["data"]["stations"]
    ]

    active_ids = {"7694", "7661"}

    rows = [
        (
            s.station_id,
            s.bikes_count,
            s.ebikes_count,
            s.num_docks_available,
            s.is_installed,
            s.is_renting,
            s.is_returning,
        )
        for s in statuses
        if s.station_id in active_ids
    ]

    assert len(rows) == 2
    assert rows[0] == ("7694", 2, 1, 7, True, True, True)
    assert rows[1] == ("7661", 0, 0, 10, True, False, True)


def test_snapshot_skips_unknown_stations(station_status_payload: dict) -> None:
    statuses = [
        StationStatus.model_validate(s)
        for s in station_status_payload["data"]["stations"]
    ]

    active_ids = {"7694"}

    rows = [
        (s.station_id, s.bikes_count, s.ebikes_count)
        for s in statuses
        if s.station_id in active_ids
    ]

    assert len(rows) == 1
    assert rows[0][0] == "7694"

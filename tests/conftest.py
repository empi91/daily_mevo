import pytest


@pytest.fixture
def station_info_payload() -> dict:
    return {
        "data": {
            "stations": [
                {
                    "station_id": "7694",
                    "name": "GPG019",
                    "address": "ul. Kazimierza Kraszewskiego 1, 83-010 Straszyn",
                    "lat": 54.27515,
                    "lon": 18.58503,
                    "is_virtual_station": True,
                    "capacity": 10,
                    "station_area": {"type": "MultiPolygon", "coordinates": []},
                    "rental_uris": {
                        "android": "rowermevo://stations/7694",
                        "ios": "rowermevo://stations/7694",
                    },
                },
                {
                    "station_id": "7661",
                    "name": "GPG017",
                    "address": "ul. Radańska 2-4, 83-004 Radunica",
                    "lat": 54.279478,
                    "lon": 18.64362,
                    "is_virtual_station": True,
                    "capacity": 10,
                    "station_area": {"type": "MultiPolygon", "coordinates": []},
                    "rental_uris": {
                        "android": "rowermevo://stations/7661",
                        "ios": "rowermevo://stations/7661",
                    },
                },
            ]
        }
    }


@pytest.fixture
def station_status_payload() -> dict:
    return {
        "data": {
            "stations": [
                {
                    "station_id": "7694",
                    "is_installed": True,
                    "is_renting": True,
                    "is_returning": True,
                    "last_reported": 1780651600,
                    "num_vehicles_available": 3,
                    "num_bikes_available": 3,
                    "num_docks_available": 7,
                    "vehicle_types_available": [
                        {"vehicle_type_id": "bike", "count": 2},
                        {"vehicle_type_id": "ebike", "count": 1},
                    ],
                },
                {
                    "station_id": "7661",
                    "is_installed": True,
                    "is_renting": False,
                    "is_returning": True,
                    "last_reported": 1780651600,
                    "num_vehicles_available": 0,
                    "num_bikes_available": 0,
                    "num_docks_available": 10,
                    "vehicle_types_available": [
                        {"vehicle_type_id": "bike", "count": 0},
                        {"vehicle_type_id": "ebike", "count": 0},
                    ],
                },
            ]
        }
    }

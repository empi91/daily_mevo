from pydantic import BaseModel


class StationResponse(BaseModel):
    station_id: str
    name: str
    address: str | None
    lat: float
    lon: float
    capacity: int | None


class AvailabilitySlot(BaseModel):
    day_of_week: int
    time_slot: str
    avg_bikes: float
    avg_ebikes: float
    sample_count: int
    reliability_label: str


class StationDetailResponse(BaseModel):
    station_id: str
    name: str
    address: str | None
    lat: float
    lon: float
    capacity: int | None
    availability: list[AvailabilitySlot]


class NearbyStationResponse(BaseModel):
    station_id: str
    name: str
    address: str | None
    lat: float
    lon: float
    capacity: int | None
    distance_m: int


class GeocodeResponse(BaseModel):
    lat: float
    lon: float
    display_name: str

from pydantic import BaseModel


class StationInfo(BaseModel):
    station_id: str
    name: str
    address: str | None = None
    lat: float
    lon: float
    capacity: int | None = None
    is_virtual_station: bool = False


class VehicleTypeAvailability(BaseModel):
    vehicle_type_id: str
    count: int


class StationStatus(BaseModel):
    station_id: str
    num_bikes_available: int
    num_docks_available: int
    vehicle_types_available: list[VehicleTypeAvailability] = []
    is_installed: bool = True
    is_renting: bool = True
    is_returning: bool = True

    @property
    def bikes_count(self) -> int:
        for vt in self.vehicle_types_available:
            if vt.vehicle_type_id == "bike":
                return vt.count
        return self.num_bikes_available

    @property
    def ebikes_count(self) -> int:
        for vt in self.vehicle_types_available:
            if vt.vehicle_type_id == "ebike":
                return vt.count
        return 0

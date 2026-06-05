from fastapi import APIRouter, HTTPException, Query, Request

from app.config import settings
from app.api.models import (
    AvailabilitySlot,
    NearbyStationResponse,
    StationDetailResponse,
    StationResponse,
)

router = APIRouter(tags=["stations"])


def _get_pool(request: Request):  # type: ignore[no-untyped-def]
    pool = getattr(request.app.state, "db_pool", None)
    if pool is None:
        raise HTTPException(status_code=503, detail="Database not available")
    return pool


def _reliability_label(avg_bikes: float, sample_count: int) -> str:
    if sample_count < settings.min_sample_count:
        return "insufficient_data"
    if avg_bikes >= settings.reliability_threshold_reliable:
        return "reliable"
    if avg_bikes >= settings.reliability_threshold_uncertain:
        return "uncertain"
    return "empty"


@router.get("/stations", response_model=list[StationResponse])
async def list_stations(request: Request) -> list[StationResponse]:
    pool = _get_pool(request)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT station_id, name, address, lat, lon, capacity "
            "FROM stations WHERE is_active = TRUE ORDER BY station_id"
        )
    return [StationResponse(**dict(r)) for r in rows]


@router.get("/stations/nearby", response_model=list[NearbyStationResponse])
async def nearby_stations(
    request: Request,
    lat: float = Query(...),
    lon: float = Query(...),
    limit: int = Query(5, ge=1, le=20),
) -> list[NearbyStationResponse]:
    pool = _get_pool(request)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT station_id, name, address, lat, lon, capacity,
                   (6371000 * acos(
                       LEAST(1.0, cos(radians($1)) * cos(radians(lat)) *
                       cos(radians(lon) - radians($2)) +
                       sin(radians($1)) * sin(radians(lat)))
                   ))::INTEGER AS distance_m
            FROM stations
            WHERE is_active = TRUE
            ORDER BY distance_m
            LIMIT $3
            """,
            lat,
            lon,
            limit,
        )
    return [NearbyStationResponse(**dict(r)) for r in rows]


@router.get("/stations/{station_id}", response_model=StationDetailResponse)
async def get_station(request: Request, station_id: str) -> StationDetailResponse:
    pool = _get_pool(request)
    async with pool.acquire() as conn:
        station = await conn.fetchrow(
            "SELECT station_id, name, address, lat, lon, capacity "
            "FROM stations WHERE station_id = $1",
            station_id,
        )
        if station is None:
            raise HTTPException(status_code=404, detail="Station not found")

        avail_rows = await conn.fetch(
            "SELECT day_of_week, time_slot, avg_bikes, avg_ebikes, sample_count "
            "FROM station_availability WHERE station_id = $1 "
            "ORDER BY day_of_week, time_slot",
            station_id,
        )

    availability = [
        AvailabilitySlot(
            day_of_week=r["day_of_week"],
            time_slot=r["time_slot"].strftime("%H:%M"),
            avg_bikes=r["avg_bikes"],
            avg_ebikes=r["avg_ebikes"],
            sample_count=r["sample_count"],
            reliability_label=_reliability_label(r["avg_bikes"], r["sample_count"]),
        )
        for r in avail_rows
    ]

    return StationDetailResponse(
        **dict(station),
        availability=availability,
    )

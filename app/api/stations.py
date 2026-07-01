from datetime import datetime, time
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query, Request

from app.config import WARSAW_TZ, settings
from app.api.models import (
    AvailabilitySlot,
    FavouriteStationResponse,
    NearbyStationResponse,
    StationDetailResponse,
    StationResponse,
)

router = APIRouter(tags=["stations"])

WARSAW = ZoneInfo(WARSAW_TZ)

POPULAR_STATION_IDS = ["4076", "3839", "4192", "4345", "4353", "3829"]


def _current_slot(now: datetime | None = None) -> tuple[int, time]:
    if now is None:
        now = datetime.now(WARSAW)
    day_of_week = now.weekday()
    minute_slot = (now.minute // 15) * 15
    time_slot = time(now.hour, minute_slot)
    return day_of_week, time_slot


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


@router.get("/stations/popular", response_model=list[FavouriteStationResponse])
async def popular_stations(request: Request) -> list[FavouriteStationResponse]:
    pool = _get_pool(request)
    day_of_week, time_slot = _current_slot()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT s.station_id, s.name, s.address, s.lat, s.lon, s.capacity,
                   sa.avg_bikes, sa.avg_ebikes, sa.sample_count
            FROM stations s
            LEFT JOIN station_availability sa
                ON sa.station_id = s.station_id
                AND sa.day_of_week = $2
                AND sa.time_slot = $3
            WHERE s.station_id = ANY($1)
              AND s.is_active = TRUE
            ORDER BY array_position($1, s.station_id)
            """,
            POPULAR_STATION_IDS,
            day_of_week,
            time_slot,
        )
    results: list[FavouriteStationResponse] = []
    for r in rows:
        avg_bikes = r["avg_bikes"]
        avg_ebikes = r["avg_ebikes"]
        sample_count = r["sample_count"]
        if (
            avg_bikes is not None
            and avg_ebikes is not None
            and sample_count is not None
        ):
            label = _reliability_label(avg_bikes + avg_ebikes, sample_count)
        else:
            label = None
        results.append(
            FavouriteStationResponse(
                station_id=r["station_id"],
                name=r["name"],
                address=r["address"],
                lat=r["lat"],
                lon=r["lon"],
                capacity=r["capacity"],
                avg_bikes=avg_bikes,
                avg_ebikes=avg_ebikes,
                reliability_label=label,
            )
        )
    return results


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
            reliability_label=_reliability_label(
                r["avg_bikes"] + r["avg_ebikes"], r["sample_count"]
            ),
        )
        for r in avail_rows
    ]

    return StationDetailResponse(
        **dict(station),
        availability=availability,
    )

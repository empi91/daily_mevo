from datetime import datetime, time, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from app.api.models import FavouriteStationResponse
from app.api.stations import _get_pool, _reliability_label
from app.auth.config import current_active_user
from app.auth.models import User

router = APIRouter(tags=["favourites"])


def _current_slot() -> tuple[int, time]:
    now = datetime.now(timezone.utc)
    day_of_week = now.weekday()
    minute_slot = (now.minute // 15) * 15
    time_slot = time(now.hour, minute_slot)
    return day_of_week, time_slot


@router.get("/favourites", response_model=list[FavouriteStationResponse])
async def list_favourites(
    request: Request,
    user: User = Depends(current_active_user),
) -> list[FavouriteStationResponse]:
    pool = _get_pool(request)
    day_of_week, time_slot = _current_slot()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT s.station_id, s.name, s.address, s.lat, s.lon, s.capacity,
                   sa.avg_bikes, sa.avg_ebikes, sa.sample_count
            FROM favourites f
            JOIN stations s ON s.station_id = f.station_id
            LEFT JOIN station_availability sa
                ON sa.station_id = f.station_id
                AND sa.day_of_week = $2
                AND sa.time_slot = $3
            WHERE f.user_id = $1
            ORDER BY f.created_at
            """,
            user.id,
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


@router.post("/favourites/{station_id}", status_code=200)
async def add_favourite(
    request: Request,
    station_id: str,
    user: User = Depends(current_active_user),
) -> dict[str, str]:
    pool = _get_pool(request)
    async with pool.acquire() as conn:
        station = await conn.fetchval(
            "SELECT station_id FROM stations WHERE station_id = $1",
            station_id,
        )
        if station is None:
            raise HTTPException(status_code=404, detail="Station not found")
        await conn.execute(
            "INSERT INTO favourites (user_id, station_id) VALUES ($1, $2) "
            "ON CONFLICT (user_id, station_id) DO NOTHING",
            user.id,
            station_id,
        )
    return {"status": "ok"}


@router.delete("/favourites/{station_id}", status_code=204)
async def remove_favourite(
    request: Request,
    station_id: str,
    user: User = Depends(current_active_user),
) -> Response:
    pool = _get_pool(request)
    async with pool.acquire() as conn:
        await conn.execute(
            "DELETE FROM favourites WHERE user_id = $1 AND station_id = $2",
            user.id,
            station_id,
        )
    return Response(status_code=204)

import httpx
from fastapi import APIRouter, HTTPException, Query

from app.api.models import GeocodeResponse

router = APIRouter(tags=["geocode"])

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"


@router.get("/geocode", response_model=GeocodeResponse)
async def geocode(q: str = Query(..., min_length=2)) -> GeocodeResponse:
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            NOMINATIM_URL,
            params={
                "q": q,
                "format": "json",
                "limit": 1,
                "countrycodes": "pl",
            },
            headers={"User-Agent": "MevoStats/1.0"},
            timeout=5.0,
        )
        resp.raise_for_status()
        results = resp.json()

    if not results:
        raise HTTPException(status_code=404, detail="Address not found")

    hit = results[0]
    return GeocodeResponse(
        lat=float(hit["lat"]),
        lon=float(hit["lon"]),
        display_name=hit["display_name"],
    )

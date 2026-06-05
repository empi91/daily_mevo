import httpx
from fastapi import APIRouter, HTTPException, Query

from app.api.models import GeocodeResponse

router = APIRouter(tags=["geocode"])

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"

_http_client = httpx.AsyncClient(
    headers={"User-Agent": "MevoStats/1.0"},
    timeout=5.0,
)


@router.get("/geocode", response_model=GeocodeResponse)
async def geocode(q: str = Query(..., min_length=2)) -> GeocodeResponse:
    try:
        resp = await _http_client.get(
            NOMINATIM_URL,
            params={
                "q": q,
                "format": "json",
                "limit": 1,
                "countrycodes": "pl",
            },
        )
        resp.raise_for_status()
        results = resp.json()
    except httpx.HTTPStatusError:
        raise HTTPException(status_code=502, detail="Geocoding service error")
    except httpx.RequestError:
        raise HTTPException(status_code=502, detail="Geocoding service unavailable")

    if not results:
        raise HTTPException(status_code=404, detail="Address not found")

    hit = results[0]
    return GeocodeResponse(
        lat=float(hit["lat"]),
        lon=float(hit["lon"]),
        display_name=hit["display_name"],
    )

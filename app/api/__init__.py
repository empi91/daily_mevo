from fastapi import APIRouter

from app.api.stations import router as stations_router
from app.api.geocode import router as geocode_router
from app.api.favourites import router as favourites_router

router = APIRouter()
router.include_router(stations_router)
router.include_router(geocode_router)
router.include_router(favourites_router)

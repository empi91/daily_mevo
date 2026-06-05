import httpx
import structlog

from app.collector.models import StationInfo, StationStatus

logger = structlog.stdlib.get_logger()

BASE_URL = "https://gbfs.urbansharing.com/rowermevo.pl"


class GBFSClient:
    def __init__(self, base_url: str = BASE_URL) -> None:
        self.base_url = base_url
        self.headers = {"Client-Identifier": "mevostats-datacollector"}
        self.timeout = 30.0

    async def fetch_station_info(self) -> list[StationInfo] | None:
        try:
            async with httpx.AsyncClient(
                headers=self.headers, timeout=self.timeout
            ) as client:
                resp = await client.get(f"{self.base_url}/station_information.json")
                resp.raise_for_status()
                data = resp.json()
                stations = data["data"]["stations"]
                return [StationInfo.model_validate(s) for s in stations]
        except Exception:
            logger.exception("Failed to fetch station information")
            return None

    async def fetch_station_status(self) -> list[StationStatus] | None:
        try:
            async with httpx.AsyncClient(
                headers=self.headers, timeout=self.timeout
            ) as client:
                resp = await client.get(f"{self.base_url}/station_status.json")
                resp.raise_for_status()
                data = resp.json()
                stations = data["data"]["stations"]
                return [StationStatus.model_validate(s) for s in stations]
        except Exception:
            logger.exception("Failed to fetch station status")
            return None

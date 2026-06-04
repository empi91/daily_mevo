from contextlib import asynccontextmanager

from fastapi import FastAPI
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    environment: str = "development"
    app_version: str = "0.1.0"

    model_config = {"env_prefix": "MEVO_"}


settings = Settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(
    title="MevoStats",
    version=settings.app_version,
    lifespan=lifespan,
)


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "version": settings.app_version,
        "environment": settings.environment,
    }

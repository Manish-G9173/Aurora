"""AURORA backend configuration, loaded from environment / .env."""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    gemini_api_key: str = ""
    database_url: str = "sqlite+aiosqlite:///./aurora.db"
    redis_url: str = "redis://localhost:6379/0"
    app_url: str = "http://localhost:3000"
    worker_secret: str = ""

    # Zerops object storage (S3-compatible)
    storage_bucket: str = ""
    storage_key: str = ""
    storage_secret: str = ""
    storage_endpoint: str = ""
    storage_region: str = ""
    storage_force_path_style: bool = True

    # Gemini fallback chain, in priority order
    gemini_live_model: str = "gemini-2.5-flash-live"
    gemini_generation_models: list[str] = [
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
        "gemini-3.5-flash-lite",
    ]
    gemini_generation_timeout: int = 30  # seconds before fallback
    gemini_base_url: str = (
        "https://generativelanguage.googleapis.com/v1beta"
    )


settings = Settings()

"""Async database engine and session factory for AURORA."""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session as SyncSession, sessionmaker

from app.config import settings
from app.models import Base

engine = create_async_engine(settings.database_url, echo=False)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def init_db() -> None:
    """Create tables if missing (idempotent, safe for dev + Zerops deploys)."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db():
    async with async_session() as session:
        yield session


# Synchronous engine for worker scripts
sync_engine = engine.sync_engine
sync_session = sessionmaker(sync_engine)

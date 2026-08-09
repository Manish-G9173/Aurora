"""Inspect local DB tables."""
import asyncio

from sqlalchemy import select

from app.database import async_session
from app.models import Session, User


async def main():
    async with async_session() as db:
        users = (await db.execute(select(User.id, User.username))).all()
        print("users:", users)
        rows = (await db.execute(select(Session.id, Session.user_id, Session.status, Session.duration_seconds))).all()
        print("sessions:", rows)


asyncio.run(main())

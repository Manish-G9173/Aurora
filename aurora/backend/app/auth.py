"""Simple JWT auth — replaces Firebase Auth with a backend-owned solution."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import User

SECRET_KEY = (settings.worker_secret or "aurora") + "-aurora-jwt-secret"  # stable across redeployments
ALGORITHM = "HS256"
ACCESS_TTL_DAYS = 30

pwd = PasswordHasher()
bearer = HTTPBearer(auto_error=False)


class LoginRequest(BaseModel):
    username: str
    password: str


def create_token(user_id: int, username: str) -> str:
    expires = datetime.now(timezone.utc) + timedelta(days=ACCESS_TTL_DAYS)
    return jwt.encode(
        {"sub": str(user_id), "username": username, "exp": expires},
        SECRET_KEY,
        algorithm=ALGORITHM,
    )


def hash_pw(pw: str) -> str:
    return pwd.hash(pw)


def verify_pw(pw: str, hashed: str) -> bool:
    try:
        return pwd.verify(hashed, pw)
    except VerifyMismatchError:
        return False


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing token")
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid token")
    row = await db.execute(select(User).where(User.id == user_id))
    user = row.scalar_one_or_none()
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unknown user")
    return user


async def get_current_user_from_token(token: str):
    """Resolve a user from a bearer token string (WebSocket query param)."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid token")
    from app.database import async_session
    async with async_session() as db:
        row = await db.execute(select(User).where(User.id == user_id))
        user = row.scalar_one_or_none()
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unknown user")
    return user

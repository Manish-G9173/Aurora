"""SQLAlchemy models for AURORA — users, resumes, sessions, metrics, reports."""
from __future__ import annotations

import enum
from datetime import datetime, timezone

from sqlalchemy import (
    Column, DateTime, Enum, Float, Integer, JSON, String, Text, func,
)
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(64), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    display_name = Column(String(128), nullable=True)
    created_at = Column(DateTime, default=utcnow)


class Resume(Base):
    __tablename__ = "resumes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False)
    filename = Column(String(255), nullable=False)
    storage_key = Column(String(512), nullable=True)  # object storage key
    text = Column(Text, nullable=True)                # extracted resume text
    score = Column(Float, nullable=True)
    analysis = Column(JSON, nullable=True)            # ATS / impact / keywords
    created_at = Column(DateTime, default=utcnow)


class Session(Base):
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False)
    resume_id = Column(Integer, nullable=True)
    mode = Column(String(32), default="practice")     # practice | focused
    status = Column(String(16), default="active")     # active | completed
    started_at = Column(DateTime, default=utcnow)
    ended_at = Column(DateTime, nullable=True)
    transcript = Column(JSON, nullable=True)          # list of {role, text, ts}
    duration_seconds = Column(Integer, nullable=True)


class Metrics(Base):
    """Per-session computer-vision and behavioural metrics."""
    __tablename__ = "metrics"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(Integer, nullable=False, index=True)
    eye_contact_pct = Column(Float, nullable=True)
    posture_stability_pct = Column(Float, nullable=True)
    looking_away_events = Column(Integer, nullable=True)
    slouch_events = Column(Integer, nullable=True)
    gaze_samples = Column(JSON, nullable=True)
    posture_samples = Column(JSON, nullable=True)
    recorded_at = Column(DateTime, default=utcnow)


class Report(Base):
    __tablename__ = "reports"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False, index=True)
    session_id = Column(Integer, nullable=False)
    overall_score = Column(Float, nullable=True)
    categories = Column(JSON, nullable=True)  # radar chart categories
    behavioural = Column(JSON, nullable=True)
    ai_feedback = Column(JSON, nullable=True)
    model_used = Column(String(64), nullable=True)  # which Gemini model scored it
    storage_key = Column(String(512), nullable=True)  # exported PDF/JSON report
    created_at = Column(DateTime, default=utcnow)


class DigestLog(Base):
    """Tracks cron coaching-digest runs."""
    __tablename__ = "digest_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False, index=True)
    run_at = Column(DateTime, default=utcnow)
    summary = Column(JSON, nullable=True)

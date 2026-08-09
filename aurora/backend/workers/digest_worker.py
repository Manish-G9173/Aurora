"""Coaching digest worker — the Zerops cron feature in action.

Run as a Zerops worker service on a schedule (e.g. weekly Monday 09:00)
or manually via `python3 -m workers.digest_worker`. For every user with
recent interview sessions it computes trend metrics and generates a
personalized coaching digest via the Gemini fallback chain, storing the
result in the digest_log table.

The same digest can be surfaced on the dashboard and sent by email when
an SMTP config is present.
"""
from __future__ import annotations

import logging
import sys
from datetime import datetime, timedelta, timezone

from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session as SyncSession

sys.path.insert(0, ".")
from app.config import settings  # noqa: E402
from app.database import sync_engine  # noqa: E402
from app.gemini import client  # noqa: E402
from app.models import DigestLog, Metrics, Report, Session, User  # noqa: E402

logger = logging.getLogger("aurora.digest")
logging.basicConfig(level=logging.INFO)

DIGEST_SYSTEM = (
    "You are a warm but direct interview coach writing a weekly coaching "
    "digest for a candidate. Reference the real numbers provided and give "
    "3 concrete practice recommendations for the coming week."
)

DIGEST_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "headline": {"type": "STRING", "description": "one-line summary"},
        "trend": {"type": "STRING", "enum": ["improving", "stable", "declining"]},
        "overall_delta": {"type": "NUMBER", "description": "score change vs previous week"},
        "key_insight": {"type": "STRING"},
        "recommendations": {"type": "ARRAY", "items": {"type": "STRING"}},
        "stats": {
            "type": "OBJECT",
            "properties": {
                "sessions_count": {"type": "NUMBER"},
                "avg_score": {"type": "NUMBER"},
                "avg_eye_contact": {"type": "NUMBER"},
                "avg_posture": {"type": "NUMBER"},
            },
            "required": ["sessions_count", "avg_score", "avg_eye_contact", "avg_posture"],
        },
    },
    "required": ["headline", "trend", "overall_delta", "key_insight", "recommendations", "stats"],
}


def user_stats(db: SyncSession, user_id: int, since: datetime):
    session_ids = db.execute(
        select(Session.id, Session.user_id)
        .where(Session.user_id == user_id, Session.ended_at >= since, Session.status == "completed")
        .order_by(desc(Session.ended_at))
    ).all()
    if not session_ids:
        return None
    recent = session_ids[:10]
    scores = []
    eyes, postures = [], []
    for sid, _ in recent:
        r = db.execute(select(Report.overall_score).where(Report.session_id == sid)).scalar()
        if r:
            scores.append(r)
        m = db.execute(select(Metrics.eye_contact_pct, Metrics.posture_stability_pct)
                       .where(Metrics.session_id == sid)).first()
        if m and m.eye_contact_pct is not None:
            eyes.append(m.eye_contact_pct)
        if m and m.posture_stability_pct is not None:
            postures.append(m.posture_stability_pct)
    return {
        "sessions_count": len(recent),
        "avg_score": round(sum(scores) / len(scores), 1) if scores else None,
        "avg_eye_contact": round(sum(eyes) / len(eyes), 1) if eyes else None,
        "avg_posture": round(sum(postures) / len(postures), 1) if postures else None,
    }


def run_digests():
    since = datetime.now(timezone.utc) - timedelta(days=7)
    with SyncSession(sync_engine) as db:
        users = db.execute(select(User)).scalars().all()
        for user in users:
            stats = user_stats(db, user.id, since)
            if not stats or stats["sessions_count"] == 0:
                continue
            msg = (
                f"User {user.username} (display: {user.display_name or user.username}) "
                f"weekly stats: {json.dumps(stats)}\n"
                f"Recent interview history notes: see sessions table.\n"
                f"Write their coaching digest."
            )
            result = client.generate_with_fallback(
                messages=[{"role": "user", "text": msg}],
                system=DIGEST_SYSTEM,
                temperature=0.5,
                response_schema=DIGEST_SCHEMA,
            )
            payload = json.loads(result.text) if result.text else None
            if not payload:
                logger.warning("digest generation failed for user %d", user.id)
                continue
            db.add(DigestLog(user_id=user.id, summary=payload))
            db.commit()
            logger.info("digest created for user %d: %s", user.id, payload.get("headline"))


if __name__ == "__main__":
    run_digests()

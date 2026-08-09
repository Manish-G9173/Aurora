"""Interview report generation with the Gemini fallback chain."""
from __future__ import annotations

import json
import logging
from typing import Optional

from app.gemini import client

logger = logging.getLogger("aurora.reports")

REPORT_SYSTEM = (
    "You are an expert interview coach. Given the interview transcript, "
    "question count, duration, and computer-vision metrics, produce a "
    "structured, specific performance report. Scores must be 0-100 numbers. "
    "Feedback must reference concrete moments from the transcript."
)

REPORT_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "overall_score": {"type": "NUMBER", "description": "0-100"},
        "technical_knowledge": {"type": "NUMBER", "description": "0-100"},
        "communication": {"type": "NUMBER", "description": "0-100"},
        "confidence": {"type": "NUMBER", "description": "0-100"},
        "problem_solving": {"type": "NUMBER", "description": "0-100"},
        "behavioural": {
            "type": "OBJECT",
            "properties": {
                "eye_contact_pct": {"type": "NUMBER"},
                "posture_stability_pct": {"type": "NUMBER"},
                "notes": {"type": "STRING"},
            },
            "required": ["eye_contact_pct", "posture_stability_pct", "notes"],
        },
        "strengths": {"type": "ARRAY", "items": {"type": "STRING"}},
        "improvements": {"type": "ARRAY", "items": {"type": "STRING"}},
        "verdict": {"type": "STRING", "description": "2-3 sentence verdict"},
    },
    "required": [
        "overall_score", "technical_knowledge", "communication",
        "confidence", "problem_solving", "behavioural", "strengths",
        "improvements", "verdict",
    ],
}


async def generate_report(
    transcript: list[dict],
    question_count: int,
    duration_seconds: int,
    eye_pct: float | None,
    posture_pct: float | None,
    resume_text: str | None,
) -> Optional[tuple[dict, str]]:
    convo = "\n".join(
        f"{t['role'].upper()}: {t['text']}" for t in transcript[-40:]
    )
    user_msg = f"""Interview data:
- Duration: {duration_seconds}s, questions asked: {question_count}
- Eye contact (CV): {eye_pct if eye_pct is not None else 'not recorded'}%
- Posture stability (CV): {posture_pct if posture_pct is not None else 'not recorded'}%
- Resume context: {resume_text[:2000] if resume_text else 'none'}

Transcript:
{convo}
"""
    result = await client.generate_with_fallback(
        messages=[{"role": "user", "text": user_msg}],
        system=REPORT_SYSTEM,
        temperature=0.3,
        response_schema=REPORT_SCHEMA,
    )
    if not result.text:
        return None
    try:
        report = json.loads(result.text)
    except json.JSONDecodeError:
        logger.error("report output was not JSON")
        return None
    # fill behavioural from CV data when AI didn't include it
    beh = report.get("behavioural", {})
    if eye_pct is not None:
        beh["eye_contact_pct"] = eye_pct
    if posture_pct is not None:
        beh["posture_stability_pct"] = posture_pct
    report["behavioural"] = beh
    return report, result.model_used

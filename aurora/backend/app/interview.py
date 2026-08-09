"""Live interview WebSocket engine.

- Uses Gemini 2.5 Flash Live (streamGenerateContent SSE) for the AI
  interviewer conversation, falling back through the model chain.
- Generates interviewer voice audio via Edge TTS and streams it to the
  client for zero-latency playback.
- Receives CV metrics from the frontend and accumulates them.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from datetime import datetime, timezone

import edge_tts
from fastapi import WebSocket, WebSocketDisconnect

from app.config import settings
from app.gemini import client
from app.models import Metrics, Session

logger = logging.getLogger("aurora.interview")

SESSIONS: dict[str, dict] = {}  # session_token -> session state

INTERVIEW_SYSTEM = (
    "You are a senior technical interviewer conducting a mock interview. "
    "Be warm but rigorous. Ask one question at a time, wait for the "
    "candidate's answer, then ask a sharp follow-up. Tailor questions to "
    "the candidate's resume when provided. Keep questions under 60 words. "
    "After 2-3 answers on one topic, move to a new topic (technical depth, "
    "system design, behavioral). Occasionally probe for weaknesses. "
    "End the interview gracefully when asked."
)


def _new_session(user_id: int, resume_text: str | None, mode: str, resume_id: int | None) -> dict:
    token = uuid.uuid4().hex
    state = {
        "token": token,
        "user_id": user_id,
        "resume_id": resume_id,
        "resume_text": resume_text,
        "mode": mode,
        "history": [],
        "cv_metrics": {"eye_samples": [], "posture_samples": []},
        "started_at": time.time(),
        "questions_asked": 0,
        "turn_id": 0,
    }
    SESSIONS[token] = state
    return state


def _build_messages(state: dict) -> list[dict[str, str]]:
    resume_hint = ""
    if state["resume_text"]:
        resume_hint = (
            f"The candidate's resume context:\n{state['resume_text'][:3000]}\n\n"
        )
    messages = [
        {"role": "user", "text": resume_hint + "Begin the mock interview. "
         "Greet the candidate and ask your first technical question."}
    ]
    for turn in state["history"]:
        messages.append(turn)
    return messages


async def _gemini_turn(state: dict, candidate_answer: str) -> tuple[str, str, bool]:
    """Ask Gemini for the interviewer's reply. Returns (text, model, fallback)."""
    if candidate_answer:
        state["history"].append({"role": "user", "text": candidate_answer})
    messages = _build_messages(state)
    result = await client.generate_with_fallback(
        messages=messages,
        system=INTERVIEW_SYSTEM,
        temperature=0.7,
    )
    if result.text:
        state["history"].append({"role": "model", "text": result.text})
        state["questions_asked"] += 1
        return result.text, result.model_used, result.fallback_used
    return "", "", False


async def _speak(text: str) -> bytes:
    """Synthesize interviewer speech with Edge TTS (retries on transient failures)."""
    last_exc = None
    for attempt in range(3):
        try:
            comm = edge_tts.Communicate(text, voice="en-US-JennyNeural", rate="-2%")
            audio = b""
            async for chunk in comm.stream():
                if chunk["type"] == "audio":
                    audio += chunk["data"]
            if audio:
                return audio
            raise RuntimeError("empty audio stream")
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            logger.warning("tts attempt %d failed: %s", attempt + 1, str(exc)[:150])
            await asyncio.sleep(0.5 * (attempt + 1))
    logger.error("tts failed after retries: %s", last_exc)
    return b""


async def interview_ws(ws: WebSocket, user_id: int, resume_text: str | None,
                       resume_id: int | None, mode: str):
    await ws.accept()
    state = _new_session(user_id, resume_text, mode, resume_id)

    async def send(data: dict) -> None:
        await ws.send_json(data)

    try:
        await send({"type": "session_start", "token": state["token"]})
        # opening question
        text, model, fallback = await _gemini_turn(state, "")
        if not text:
            await send({"type": "error", "message": "AI interviewer unavailable. Check your Gemini API key."})
            await ws.close()
            return
        await send({"type": "turn", "turn_id": state["turn_id"],
                    "role": "interviewer", "text": text,
                    "model_used": model, "fallback_used": fallback})
        audio = await _speak(text)
        await send({"type": "audio", "turn_id": state["turn_id"], "data": audio.hex()})

        cv_tasks = []

        async def process_candidate(payload: dict) -> None:
            answer = payload.get("text", "").strip()
            # track CV metrics from frontend
            if payload.get("eye") is not None:
                state["cv_metrics"]["eye_samples"].append(payload["eye"])
            if payload.get("posture") is not None:
                state["cv_metrics"]["posture_samples"].append(payload["posture"])

            await send({"type": "thinking", "turn_id": state["turn_id"]})
            state["turn_id"] += 1
            text, model, fallback = await _gemini_turn(state, answer)
            if not text:
                await send({"type": "turn", "turn_id": state["turn_id"],
                            "role": "interviewer",
                            "text": "I'm having a momentary connection issue — could you elaborate on your last point?",
                            "model_used": model or "fallback-failed"})
                return
            await send({"type": "turn", "turn_id": state["turn_id"],
                        "role": "interviewer", "text": text,
                        "model_used": model, "fallback_used": fallback})
            audio = await _speak(text)
            await send({"type": "audio", "turn_id": state["turn_id"], "data": audio.hex()})

        try:
            while True:
                payload = await ws.receive_json()
                msg_type = payload.get("type")
                if msg_type == "candidate":
                    await process_candidate(payload)
                elif msg_type == "metrics":
                    state["cv_metrics"]["eye_samples"].extend(payload.get("eye_history", []))
                    state["cv_metrics"]["posture_samples"].extend(payload.get("posture_history", []))
                elif msg_type == "end_interview":
                    await send({"type": "session_ended", "token": state["token"]})
                    break
        except WebSocketDisconnect:
            pass

    finally:
        # persist session + metrics
        duration = int(time.time() - state["started_at"])
        try:
            from app.database import async_session as db_factory
            from sqlalchemy import select as _select
            async with db_factory() as db:
                session = Session(
                    user_id=user_id, resume_id=resume_id, mode=mode,
                    status="completed", ended_at=datetime.now(timezone.utc),
                    transcript=state["history"],
                    duration_seconds=duration,
                )
                db.add(session)
                await db.flush()

                eye = state["cv_metrics"]["eye_samples"]
                posture = state["cv_metrics"]["posture_samples"]
                eye_avg = sum(eye) / len(eye) * 100 if eye else None
                posture_avg = sum(posture) / len(posture) * 100 if posture else None
                db.add(Metrics(
                    session_id=session.id,
                    eye_contact_pct=round(eye_avg, 1) if eye_avg is not None else None,
                    posture_stability_pct=round(posture_avg, 1) if posture_avg is not None else None,
                    looking_away_events=sum(1 for v in eye if v == 0) if eye else 0,
                    slouch_events=sum(1 for v in posture if v == 0) if posture else 0,
                    gaze_samples=eye[-200:] if eye else None,
                    posture_samples=posture[-200:] if posture else None,
                ))
                await db.commit()
                state["persisted_session_id"] = session.id
        except Exception as exc:  # noqa: BLE001
            logger.error("session persistence failed: %s", exc)
        finally:
            SESSIONS.pop(state["token"], None)

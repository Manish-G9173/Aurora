"""AURORA API — FastAPI application."""
from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, UploadFile, File, Query, Request, status, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from sqlalchemy import desc, select

from app.auth import (
    LoginRequest, create_token, get_current_user, get_current_user_from_token,
    hash_pw, verify_pw,
)
from app.cache import cache
from app.config import settings
from app.database import get_db, init_db
from app.database import async_session
from app.gemini import client
from app.interview import interview_ws
from app.models import DigestLog, Metrics, Report, Resume, Session, User
from app.reports import generate_report
from app.resumes import extract_pdf_text, score_resume
from app.storage import read_file, upload_file

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("aurora")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    logger.info("AURORA backend started — db=%s", settings.database_url.split("@")[-1] if "@" in settings.database_url else settings.database_url)
    yield
    await client.close()


app = FastAPI(title="AURORA API", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def worker_auth(request: Request):
    if settings.worker_secret and request.headers.get("X-Worker-Secret") != settings.worker_secret:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid worker secret")


# ------------------------------------------------------------------
# Auth
# ------------------------------------------------------------------
@app.post("/api/auth/register")
async def register(req: LoginRequest, db=Depends(get_db)):
    if len(req.username) < 3 or len(req.password) < 6:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "username min 3 chars, password min 6")
    existing = await db.execute(select(User).where(User.username == req.username))
    if existing.scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "username taken")
    user = User(username=req.username, password_hash=hash_pw(req.password),
                display_name=req.username)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return {"token": create_token(user.id, user.username), "user": {"id": user.id, "username": user.username}}


@app.post("/api/auth/login")
async def login(req: LoginRequest, db=Depends(get_db)):
    row = await db.execute(select(User).where(User.username == req.username))
    user = row.scalar_one_or_none()
    if not user or not verify_pw(req.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid credentials")
    return {"token": create_token(user.id, user.username), "user": {"id": user.id, "username": user.username}}


@app.get("/api/me")
async def me(user: User = Depends(get_current_user)):
    return {"id": user.id, "username": user.username, "display_name": user.display_name}


# ------------------------------------------------------------------
# Resumes
# ------------------------------------------------------------------
@app.post("/api/resumes")
async def upload_resume(file: UploadFile = File(...), user: User = Depends(get_current_user)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "only PDF resumes")
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "file too large (max 10MB)")
    text = extract_pdf_text(content)
    if not text.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "could not extract text from PDF")

    storage_key = upload_file(file.filename, content, "application/pdf")

    # score (cached 1h per resume text hash to save API credits)
    cache_key = f"resume_score:{hash(text[:1500])}"
    cached = await cache.get(cache_key)
    if cached:
        analysis = json.loads(cached)
        model_used = "cached"
    else:
        result = await score_resume(text)
        if result is None:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "AI scoring unavailable")
        analysis, model_used = result
        await cache.set(cache_key, json.dumps(analysis), ttl=3600)

    resume = Resume(
        user_id=user.id, filename=file.filename, storage_key=storage_key,
        text=text, score=analysis.get("overall_score"), analysis=analysis,
    )
    async with async_session() as db:
        db.add(resume)
        await db.commit()
        await db.refresh(resume)
    return {
        "id": resume.id, "filename": resume.filename, "score": resume.score,
        "analysis": resume.analysis, "model_used": model_used,
    }


@app.get("/api/resumes")
async def list_resumes(user: User = Depends(get_current_user)):
    async with async_session() as db:
        rows = (await db.execute(
            select(Resume).where(Resume.user_id == user.id).order_by(desc(Resume.created_at))
        )).scalars().all()
        return [{"id": r.id, "filename": r.filename, "score": r.score,
                 "analysis": r.analysis, "created_at": r.created_at.isoformat()} for r in rows]


# ------------------------------------------------------------------
# Live interview
# ------------------------------------------------------------------
@app.websocket("/api/interview/ws")
async def ws_interview(
    ws: WebSocket, ws_token: str = Query(...),
    resume_id: int = Query(default=None), mode: str = Query(default="practice"),
):
    user = await get_current_user_from_token(ws_token)
    resume_text = None
    if resume_id:
        async with async_session() as db:
            resume = (await db.execute(
                select(Resume).where(Resume.id == resume_id, Resume.user_id == user.id)
            )).scalar_one_or_none()
            if resume:
                resume_text = resume.text
    await interview_ws(ws, user.id, resume_text, resume_id, mode)


# ------------------------------------------------------------------
# Reports
# ------------------------------------------------------------------
@app.post("/api/reports/{session_id}")
async def build_report(session_id: int, user: User = Depends(get_current_user)):
    async with async_session() as db:
        session = (await db.execute(
            select(Session).where(Session.id == session_id, Session.user_id == user.id)
        )).scalar_one_or_none()
        if not session:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "session not found")
        existing = (await db.execute(
            select(Report).where(Report.session_id == session_id)
        )).scalar_one_or_none()
        if existing:
            return {"id": existing.id, "report": existing.ai_feedback, "model_used": existing.model_used}

        metrics = (await db.execute(
            select(Metrics).where(Metrics.session_id == session_id)
        )).scalar_one_or_none()
        resume_text = None
        if session.resume_id:
            resume = (await db.execute(
                select(Resume).where(Resume.id == session.resume_id)
            )).scalar_one_or_none()
            if resume:
                resume_text = resume.text

        eye = metrics.eye_contact_pct if metrics else None
        posture = metrics.posture_stability_pct if metrics else None
        result = await generate_report(
            session.transcript or [], 0,
            session.duration_seconds or 0, eye, posture, resume_text,
        )
        if result is None:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "report generation unavailable")
        report_dict, model_used = result

        report = Report(
            user_id=user.id, session_id=session_id,
            overall_score=report_dict.get("overall_score"),
            categories={
                "Technical Knowledge": report_dict.get("technical_knowledge"),
                "Communication": report_dict.get("communication"),
                "Confidence": report_dict.get("confidence"),
                "Problem Solving": report_dict.get("problem_solving"),
            },
            behavioural=report_dict.get("behavioural", {}),
            ai_feedback=report_dict, model_used=model_used,
        )
        db.add(report)
        await db.commit()
        await db.refresh(report)
        return {"id": report.id, "report": report_dict, "model_used": model_used}


@app.get("/api/reports")
async def list_reports(user: User = Depends(get_current_user), limit: int = Query(default=20)):
    async with async_session() as db:
        rows = (await db.execute(
            select(Report).where(Report.user_id == user.id).order_by(desc(Report.created_at)).limit(limit)
        )).scalars().all()
        return [{"id": r.id, "session_id": r.session_id, "overall_score": r.overall_score,
                 "categories": r.categories, "behavioural": r.behavioural,
                 "ai_feedback": r.ai_feedback, "model_used": r.model_used,
                 "created_at": r.created_at.isoformat()} for r in rows]


# ------------------------------------------------------------------
# Dashboard overview
# ------------------------------------------------------------------
@app.get("/api/dashboard")
async def dashboard(user: User = Depends(get_current_user)):
    async with async_session() as db:
        sessions = (await db.execute(
            select(Session).where(Session.user_id == user.id).order_by(desc(Session.started_at)).limit(50)
        )).scalars().all()
        reports = (await db.execute(
            select(Report).where(Report.user_id == user.id).order_by(desc(Report.created_at)).limit(50)
        )).scalars().all()
        digests = (await db.execute(
            select(DigestLog).where(DigestLog.user_id == user.id).order_by(desc(DigestLog.run_at)).limit(5)
        )).scalars().all()
        report_by_session = {r.session_id: r for r in reports}

        overall_trend = []
        for s in reversed(sessions):
            r = report_by_session.get(s.id)
            if r:
                overall_trend.append({
                    "session_id": s.id, "score": r.overall_score,
                    "date": s.ended_at.isoformat() if s.ended_at else s.started_at.isoformat(),
                })

        latest_digest = None
        if digests:
            latest_digest = {"summary": digests[0].summary, "run_at": digests[0].run_at.isoformat()}

        return {
            "sessions": [
                {"id": s.id, "mode": s.mode, "status": s.status,
                 "duration_seconds": s.duration_seconds,
                 "started_at": s.started_at.isoformat(),
                 "report": report_by_session.get(s.id).ai_feedback if s.id in report_by_session else None}
                for s in sessions
            ],
            "overall_trend": overall_trend,
            "latest_digest": latest_digest,
        }


# ------------------------------------------------------------------
# Coaches digest on demand (also wired as Zerops cron worker endpoint)
@app.post("/api/digest/run")
async def run_digest(request: Request):
    worker_auth(request)
    from workers.digest_worker import run_digests
    run_digests()
    return {"ok": True}


# ------------------------------------------------------------------
# Health / storage passthrough
# ------------------------------------------------------------------
@app.get("/healthz")
async def health():
    return {"status": "ok", "service": "aurora-api"}


@app.get("/storage/{key:path}")
async def serve_storage(key: str):
    content = read_file(key)
    if content is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return PlainTextResponse(content, media_type="application/octet-stream",
                             headers={"Content-Disposition": f"attachment; filename={key}"})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=False)

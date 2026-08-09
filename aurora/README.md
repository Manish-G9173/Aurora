# AURORA — AI Interview Coach

**AURORA** is an AI-driven interview preparation platform that conducts realistic mock interviews with live posture and eye-contact feedback, adaptive technical questioning, and detailed performance analytics — rebuilt from the ground up for cloud-native deployment on [Zerops](https://zerops.io).

Where AURA was a prototype, AURORA is a platform: every external dependency (Firebase, Cloudinary) has been replaced with Zerops-native infrastructure — managed PostgreSQL, object storage, Redis-compatible caching, and cron workers — all described declaratively in `zerops.yaml` files.

## Features

- **Real-Time AI Mock Interviews** — dynamic voice interaction via Edge TTS, adaptive questioning that reacts to your resume and answers, WebSocket-powered live conversation with zero-latency streaming using Gemini 2.5 Flash Live.
- **The AURORA Eye (Computer Vision)** — MediaPipe pose detection for posture alerts and iris tracking for eye-contact scoring, with live yellow/red warnings on your video feed.
- **Intelligent Resume Analysis** — PDF parsing with AI scoring on ATS compatibility, impact, and keywords. Resumes are stored in Zerops object storage.
- **Deep-Dive Performance Reports** — skill radar charts, session history, and behavioral insights (eye contact %, posture stability) persisted in PostgreSQL.
- **Automated Coaching Digests** — a Zerops cron worker generates weekly personalized improvement reports from your interview history.

## Architecture

| Service | Stack | Zerops service | `zerops.yaml` |
|---|---|---|---|
| Web app (frontend) | React 18 + Vite + Tailwind | Static hosting | `zerops.yaml` in `/frontend` |
| API (backend) | Python FastAPI + Uvicorn | Container runtime | `zerops.yaml` in `/backend` |
| PostgreSQL | Managed database | Postgres service | See `DEPLOYMENT.md` |
| Valkey cache | Cache | Valkey service | See `DEPLOYMENT.md` |
| Object storage | Resume files & report exports | Object storage service | See `DEPLOYMENT.md` |
| Coaching digest | Cron worker | Worker service | `workers/digest/cron.yaml` |

## Gemini Model Fallback Chain

Interviews use a tiered fallback so a single model outage never breaks the flow:

1. `gemini-2.5-flash-live` — streaming interview conversation
2. `gemini-2.5-flash` — resume analysis and report generation
3. `gemini-2.5-flash-lite` — fallback for generation tasks
4. `gemini-3.5-flash-lite` — final fallback

Fallbacks are triggered automatically on API errors or latency thresholds; each attempt is logged and visible in session diagnostics.

## Quickstart (local)

```bash
# Backend
cd backend
cp .env.example .env        # add your GEMINI_API_KEY and DATABASE_URL
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python3 -m app.main

# Frontend
cd ../frontend
npm install
npm run dev
```

## Deployment on Zerops

Follow `DEPLOYMENT.md` for the full step-by-step: creating the Zerops project, provisioning Postgres/Valkey/object storage, configuring private networking, and deploying each service with `zerops.yaml`.

## API Key

Your Gemini API key lives in `backend/.env` (gitignored). Copy `backend/.env.example` and set `GEMINI_API_KEY`.

## License

MIT

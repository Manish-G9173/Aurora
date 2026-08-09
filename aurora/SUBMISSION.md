# AURORA — Zerops Challenge Submission Guide

This document explains exactly what to write in the challenge submission form, how to answer the
"explain your usage of Zerops" question, and how to present the project so it matches what the
judges are looking for.

## 1. Elevator pitch (project description field)

> AURORA is an AI interview coach that runs mock interviews with a live AI interviewer. Unlike a
> chatbot, AURORA watches you through your webcam: a MediaPipe vision model tracks eye contact and
> head posture in real time and warns you when you look away or slouch. The interviewer speaks out
> loud (Edge TTS), remembers your uploaded resume to ask resume-specific questions, and produces a
> structured coaching report after every session — technical knowledge, communication, confidence
> and problem-solving scores, plus strengths and improvements. A weekly coaching digest cron job
> emails-scale summary of your progress automatically.

## 2. How AURORA uses Zerops (the question that wins the MacBook)

The challenge organisers stated the winning formula is at least three services (frontend + backend
+ database) and meaningful use of Zerops-native features. AURORA uses **six**:

| Service | Zerops feature | Why it matters |
|---|---|---|
| `aurora-frontend` | Static hosting + `envReplace` | React bundle deployed over HTTPS; the API domain is injected at deploy time from a service secret |
| `aurora-api` | Container service + `zerops.yaml` + readiness check | FastAPI on uvicorn with WebSocket support declared natively in `zerops.yaml` |
| `aurora-postgres` | Managed PostgreSQL | Interviews, resumes, scores, trends — connected through the private network (`$PRIVATE_POSTGRESQL_hostname`) |
| `aurora-valkey` | Managed Valkey (Redis) | Caches Gemini model responses so repeat resume analyses are instant and free |
| `aurora-storage` | Object storage (S3-compatible) | Stores uploaded resume PDFs; the app uses boto3 against Zerops's S3 endpoint |
| `aurora-worker` | Worker service + `crontab` | Runs the weekly coaching digest on a cron schedule with no separate infra |

Private networking between services is declared once in the backend's `zerops.yaml`; you never
provision, patch or scale anything — that is the zero-ops story.

## 3. Demo video script (2–3 minutes)

1. **Hook (0:00–0:15):** Show the live dashboard — "This is AURORA, an AI that interviews you like a
   real recruiter and coaches you like a human one."
2. **Resume upload (0:15–0:45):** Upload a PDF → show the ATS compatibility bars and suggestions →
   click "Interview me on this resume".
3. **Live interview (0:45–1:45):** Start the interview, let Gemini 2.5 Flash Live ask a question,
   answer it by typing, show the interviewer speaking (audio indicator) and the live HUD gauges
   (eye contact / posture) reacting as you look away.
4. **Report (1:45–2:15):** Open the generated report — radar chart, verdict, strengths,
   improvements.
5. **Zerops story (2:15–end):** Show the Zerops dashboard with the six services, the private
   network variables, the object storage bucket, and the crontab entry in `zerops.yaml`.

Keep the deployment URL open in a second tab for the whole demo — judges verify that the live app
stays up through judging.

## 4. Social build post (required for the social post prize)

> 🎙️ I built AURORA for the @WeMakeDevs Zerops Challenge — an AI interview coach that runs live
> mock interviews, watches your eye contact & posture through your webcam, speaks out loud, and
> generates structured coaching reports after every session.
>
> 6 Zerops services, zero ops: React frontend (static hosting + envReplace), FastAPI backend,
> managed Postgres + Valkey, object storage for resumes, and a cron worker sending weekly coaching
> digests.
>
> Try it live: <YOUR FRONTEND URL>
> Source: <YOUR GITHUB REPO URL>
>
> @zeropsio @WeMakeDevs #ZeroOpsChallenge #Hackathon

## 5. Before you submit — checklist

| Item | Status |
|---|---|
| All 6 services deployed on Zerops and healthy | ☐ |
| Frontend URL publicly reachable and stays up | ☐ |
| `API_URL` secret set on `aurora-frontend` service | ☐ |
| `GEMINI_API_KEY` + `WORKER_SECRET` secrets set on `aurora-api` | ☐ |
| Live interview flow tested end-to-end on production | ☐ |
| One real coaching report generated on production | ☐ |
| GitHub repo is yours (new `aura`/`aurora` repo), history starts with your work | ☐ |
| Demo video recorded + uploaded | ☐ |
| Social post published with live URL + repo URL | ☐ |
| Submission form: disclose AURA as prior-art inspiration, new work done during event | ☐ |

## 6. About prior art (important — do not skip this)

AURORA was inspired by the existing open-source project AURA (github.com/Nithaesh/aura). That
project was **not** submitted: AURORA is a new repository with a fresh commit history, a rebuilt
backend, Zerops-native infrastructure (AURA used Firebase/Cloudinary), a new cron digest feature,
and a completely new frontend. In the submission form, mention this honestly in one sentence —
judges explicitly asked whether projects were built during the event, and transparency about
inspiration is allowed; submitting pre-finished work is what is prohibited.

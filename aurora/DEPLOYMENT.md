# AURORA — Zerops Deployment Guide

AURORA runs as a multi-service stack on Zerops, matching the winning formula of the challenge: **frontend (static hosting) + backend (Python container) + managed PostgreSQL**, plus Zerops-native **Valkey cache**, **object storage** for resume PDFs, and a **cron worker** that generates weekly coaching digests.

## Architecture on Zerops

| Service | Zerops primitive | Purpose |
|---|---|---|
| `aurora-frontend` | Static hosting | Vite production build (React + Tailwind) |
| `aurora-api` | Container service (Python 3.12) | FastAPI backend with WebSocket interview room |
| `aurora-postgres` | Managed PostgreSQL | Users, resumes, interview sessions, metrics, reports |
| `aurora-valkey` | Managed Valkey | Response cache (resume scoring), rate limiting |
| `aurora-storage` | Object storage (S3) | Resume PDF files |
| `aurora-worker` | Worker service (cron) | Weekly coaching digest generation |

## Step-by-step setup

1. **Create the project**
   - In the Zerops dashboard, click *Create project*, name it `aurora`, and select a region.
   - AURORA is a solo buildathon project, so one project with shared private networking is enough.

2. **Add services** (order matters for env interpolation)
   - Add **PostgreSQL** service named `aurora-postgres`. Create database `aurora` and user `aurora`.
   - Add **Valkey** service named `aurora-valkey`.
   - Add **Object storage** service named `aurora-storage`.
   - Add **Container service** named `aurora-api`, connect it to your GitHub repo, set path `backend`, select `zerops.yaml` from the service setup list (it appears automatically because the file exists in that folder).
   - Add **Worker service** named `aurora-worker`, same repo, path `backend`, `zerops.yaml`.
   - Add **Static hosting** service named `aurora-frontend`, path `frontend`, `zerops.yaml`.

3. **Configure secrets** (in the `aurora-api` and `aurora-worker` services, under *Variables & secrets*)
   - `GEMINI_API_KEY` — your Google Gemini API key from AI Studio.
   - `WORKER_SECRET` — a random 32-char string (e.g. `openssl rand -hex 32`).

4. **Private networking** (automatic)
   - Zerops injects `$PRIVATE_POSTGRESQL_hostname`, `$PRIVATE_VALKEY_hostname`, and the object storage variables into the containers. No public endpoints, no firewall setup needed — this is exactly what the judges want to see.

5. **Build and deploy**
   - Deploy each service. The container and worker run `pip install -r requirements.txt` and start uvicorn / the cron schedule automatically.
   - The frontend builds with `pnpm build` and is served over HTTPS.

6. **Wire the frontend to the API**
   - Zerops static hosting can replace placeholders in your built files at deploy time (`run.envReplace`). The frontend build already emits `__API_URL__` placeholders for the API base — add `API_URL` (e.g. `https://aurora-api.<project>.zerops.app`) as a variable in the `aurora-frontend` service's *Variables & Secrets*, and Zerops substitutes it into the deployed JS bundle automatically.

7. **Set up the cron digest**
   - The `aurora-worker` service reads `zerops.yaml` and schedules the weekly digest every Monday 09:00 automatically. You can also trigger it on demand:
     ```bash
     curl -X POST https://aurora-api.<project>.zerops.app/api/digest/run \
       -H "X-Worker-Secret: $WORKER_SECRET"
     ```

## Health check

`GET https://aurora-api.<project>.zerops.app/healthz` → `{"status":"ok","service":"aurora-api"}`

Zerops also auto-scales and restarts failed containers, and keeps your database backups — mention that in your submission as operational zero-ops.

## Local development

```bash
# Backend
cd backend
cp .env.example .env        # add your GEMINI_API_KEY; leave DATABASE_URL as SQLite
python3 -m app.main         # http://localhost:8000

# Frontend
cd frontend
pnpm install
pnpm dev                    # http://localhost:5173
```

The backend automatically falls back to SQLite + in-memory cache when no managed services are present, so local development needs zero infrastructure.

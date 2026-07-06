# CAM API (FastAPI)

Backend tier. Owns all business logic; the mobile app talks ONLY to this API.
The API talks to Supabase (Postgres + Storage) using the service-role key.

## Run locally
    cd backend/api
    python -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    cp .env.example .env   # fill in values
    uvicorn app.main:app --reload --port 8000

Docs (auto): http://localhost:8000/docs

## Auth model
1. App signs in via Supabase Auth -> receives a JWT access token.
2. App sends `Authorization: Bearer <token>` to this API.
3. API verifies the JWT (SUPABASE_JWT_SECRET), loads the teacher_account,
   then performs DB/storage ops with the service-role key.

## Layout
    app/
      main.py            # app factory, CORS, router mounting
      config.py          # settings from env
      db.py              # Supabase client (service role)
      deps.py            # auth dependency -> current teacher
      core/security.py   # JWT verification
      models/schemas.py  # pydantic request/response models
      routers/           # auth, people, attendance, reports
      services/          # business logic (attendance, storage, export, retention)
    tests/

## Deploy (free)
Render free web service or Fly.io. Set env vars in the dashboard. Run a scheduled
job (Render Cron / GitHub Actions) hitting the retention purge.

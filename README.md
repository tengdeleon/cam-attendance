# CAM — Center Attendance Monitoring

Full-stack mobile app for **teachers** to log attendance of **teachers and students** entering the center, verified by a **selfie** + timestamp. Built on free tools.

Full spec: [`docs/PROJECT_INSTRUCTIONS.md`](docs/PROJECT_INSTRUCTIONS.md) · Data model: [`docs/data-model.md`](docs/data-model.md)

## Stack (3-tier full-stack)

- **Client** — React Native + Expo (TypeScript), React Navigation, expo-camera, expo-sqlite (offline queue).
- **Backend API** — FastAPI (Python) + Uvicorn. Owns all business logic; holds the Supabase service-role key. The client calls this, never the DB directly.
- **Data** — Supabase free tier: Postgres + Storage + Auth (issues the JWT the API verifies).

Flow: `Expo client → FastAPI → Supabase`. Auth: client logs in via Supabase Auth, sends the JWT to the API, the API verifies it and acts with the service-role key.

## Folder structure

```
CAM-Center Attendance Monitoring/
├── README.md
├── docs/
│   ├── PROJECT_INSTRUCTIONS.md     # goal, scope, flow, milestones, privacy
│   ├── data-model.md               # tables, RLS, queries
│   └── decisions.md                # architecture decision log
├── app/                            # TIER 1 — Expo React Native client
│   ├── app.json                    # Expo config (placeholder)
│   ├── package.json                # deps (placeholder)
│   ├── .env.example                # Supabase auth + API base URL
│   ├── assets/
│   │   ├── images/
│   │   └── fonts/
│   └── src/
│       ├── App.tsx                 # entry
│       ├── screens/
│       │   ├── auth/               # LoginScreen
│       │   ├── attendance/         # CheckIn, Camera, Today
│       │   ├── roster/             # RosterList, PersonForm
│       │   └── reports/            # History, Export
│       ├── components/             # reusable UI
│       ├── navigation/             # RootNavigator, tabs/stacks
│       ├── services/               # apiClient + *Api (call FastAPI); supabaseClient (auth only); syncQueue
│       ├── hooks/                  # useAuth, useAttendance, useNetwork
│       ├── context/                # AuthContext
│       ├── utils/                  # date, image, csv
│       ├── constants/              # config, theme
│       └── types/                  # shared TS types
└── backend/
    ├── api/                        # TIER 2 — FastAPI backend (all business logic)
    │   ├── requirements.txt
    │   ├── .env.example            # service-role key, JWT secret, bucket, retention
    │   ├── README.md
    │   ├── app/
    │   │   ├── main.py             # app factory, CORS, routers, /health
    │   │   ├── config.py · db.py · deps.py
    │   │   ├── core/security.py    # JWT verification
    │   │   ├── models/schemas.py   # pydantic models
    │   │   ├── routers/            # people, attendance, reports, admin
    │   │   └── services/           # attendance, storage, export, retention
    │   └── tests/                  # pytest (test_health.py passing)
    └── supabase/                   # TIER 3 — managed data
        ├── migrations/0001_init.sql  # schema + RLS
        └── functions/                # optional edge functions
```

## Getting started (when you build)

1. Create a free Supabase project; run `backend/supabase/migrations/0001_init.sql`; create a private `selfies` storage bucket.
2. **Backend:** `cd backend/api`, create a venv, `pip install -r requirements.txt`, copy `.env.example`→`.env` (Supabase URL, service-role key, JWT secret), `uvicorn app.main:app --reload --port 8000`. Verify `http://localhost:8000/docs`.
3. **Client:** `cd app && npm install`; copy `.env.example`→`.env` (Supabase URL + anon key, and `EXPO_PUBLIC_API_BASE_URL`).
4. `npx expo start` and open in Expo Go.

Run `pytest` in `backend/api` to verify the backend.

> Privacy: capturing student images requires parental consent and a retention policy. See §9 of the spec before any pilot.

# CAM — Center Attendance Monitoring

Project instructions and build spec.
Last updated: 2026-06-26.

## 1. Goal

A mobile app used by **teachers** to log the attendance of **teachers and students** entering the center. Each log entry is verified with a **selfie** captured at check-in, stamped with date/time and the person's identity. Built entirely on **free tools / free tiers**.

## 2. Scope

In scope (v1, MVP):

- Teacher login (email + password).
- Roster of people (teachers + students) managed in-app.
- Check-in / check-out with a mandatory selfie + automatic timestamp.
- Today's attendance view (who's in, who's out).
- Attendance history with date filter and CSV export.
- Offline-tolerant capture: queue entries when no network, sync when back online.

Out of scope (v1):

- Payroll / grading / billing integration.
- Parent-facing app or notifications.
- Facial-recognition matching (selfie is for human verification only, not auto-ID).
- Multi-center / franchise-wide dashboard (single center only).
- Forced password change on first login + self-service password reset. (v1 provisions teachers with an admin-assigned temp password via `POST /admin/teachers`; changing it is a v2 item.)

These are candidate v2 items, not v1.

## 3. Users & roles

| Role | Capabilities |
|---|---|
| Teacher (operator) | Log in; check people in/out; capture selfie; view today + history; export CSV |
| Admin (a teacher flagged `is_admin`) | All teacher rights + add/edit/deactivate people in the roster; manage teacher accounts |
| Student | No app access. Subject of attendance records only. |

A "person" record covers both teachers and students; `role` distinguishes them. Only teachers/admins authenticate.

## 4. Attendance capture flow (selfie-based)

1. Teacher opens the app (already authenticated) and lands on the **Check-In** screen.
2. Teacher selects a person from the roster (search by name; filter teacher/student).
3. Teacher chooses **Check In** or **Check Out**.
4. Camera opens (front-facing). Teacher captures a selfie of the person at the entrance.
5. App sends a multipart `POST /attendance` to the FastAPI backend: person, direction (in/out), device time, the auth token, and the selfie image.
6. The backend validates the person, uploads the selfie to Supabase Storage, sets the server timestamp (source of truth), and inserts the `attendance` row with the stored file path.
7. If offline: the request + image are queued locally (`expo-sqlite`) and marked `pending`; a background task replays it against `POST /attendance` when connectivity returns.

Rules:

- A selfie is **required** to complete a check-in/out. No selfie, no record.
- Timestamp is set by the server on insert (source of truth); the device timestamp is also stored to detect clock drift / offline delays.
- Direction toggles based on last known state but the teacher can override.

## 5. Data model

See `docs/data-model.md` for full detail. Core tables (Postgres / Supabase):

- `people` — id, full_name, role (`teacher`|`student`), photo_url, is_active, created_at.
- `teacher_accounts` — id, person_id (FK), auth_user_id, is_admin, created_at. (Links an auth login to a person.)
- `attendance` — id, person_id (FK), direction (`in`|`out`), selfie_url, logged_by (teacher_account FK), device_time, server_time, sync_status.

Storage bucket: `selfies/` — one image per attendance record, path `selfies/{yyyy}/{mm}/{dd}/{attendance_id}.jpg`.

## 6. Screens

| Screen | Folder | Purpose |
|---|---|---|
| Login | `screens/auth` | Email/password sign-in |
| Check-In (home) | `screens/attendance` | Pick person → in/out → selfie |
| Camera/Selfie | `screens/attendance` | Capture + confirm selfie |
| Today | `screens/attendance` | Live who's-in / who's-out list |
| Roster list | `screens/roster` | Browse/search people |
| Person add/edit | `screens/roster` | Admin manages a person |
| History | `screens/reports` | Date-filtered records |
| Export | `screens/reports` | Generate + share CSV |

## 7. Architecture (full-stack, 3-tier)

This is a true full-stack app with three separated tiers:

```
[ Mobile client ]        [ Backend API ]            [ Managed data ]
 Expo / React Native  →   FastAPI (Python)      →    Supabase
 - UI, camera             - all business logic        - Postgres (data)
 - auth login             - validation, auth check     - Storage (selfies)
 - offline queue          - selfie upload orchestr.    - Auth (issues JWT)
 - calls the API ONLY     - CSV export, retention
```

Key rule: **the client never touches the database or storage directly.** It calls the FastAPI backend, which is the only component holding the Supabase service-role key. This gives a real server tier to own business rules, keeps secrets off the device, and is a stronger portfolio/SWE artifact than a BaaS-only app.

### Auth flow
1. Client signs in with Supabase Auth (`supabase-js`) → receives a JWT access token.
2. Client sends every API request with `Authorization: Bearer <token>`.
3. FastAPI verifies the JWT (`SUPABASE_JWT_SECRET`), looks up the `teacher_accounts` row, then performs DB/storage work with the service-role key.
4. Row-Level Security remains enabled as defense-in-depth, but enforcement primarily lives in the API.

## 7a. Tech stack (free tools only)

| Tier | Choice | Why free |
|---|---|---|
| Client | **React Native + Expo** (TypeScript) | OSS; one codebase → Android + iOS; Expo Go for free on-device testing |
| Client libs | React Navigation, `expo-camera`, `expo-sqlite` | Free, OSS |
| **Backend API** | **FastAPI (Python) + Uvicorn** | OSS; auto OpenAPI docs; tiny footprint; free hosting on Render/Fly free tier |
| API auth | `python-jose` (verify Supabase JWT) | Free |
| Data / Auth / Storage | **Supabase free tier** | Postgres + Auth + Storage (500MB DB, 1GB storage, 50K MAU) |
| Hosting (API) | Render free web service or Fly.io | Free tier |
| Scheduled purge | Render Cron or GitHub Actions → API endpoint | Free |
| Version control | Git + GitHub | Free |

**Why FastAPI in front of Supabase:** gives a genuine backend tier to own validation and business logic, keeps the service-role key server-side, and makes the system swappable (the DB could change without touching the client). Supabase stays as managed Postgres + Storage + token issuer. Firebase is a possible data-layer fallback but Postgres/SQL fits the team's background better.

Trade-offs / risks:

- Free-tier storage (1GB) limits selfie volume. ~100KB/selfie → ~10K selfies. Mitigate: compress to ~50–80KB, and/or purge/archive selfies older than N months.
- Supabase free projects pause after ~1 week of inactivity — fine for daily use, but note it.
- Selfies are personal data of minors → see §9. This is the highest-risk part of the project; do not skip it.
- EAS free build minutes are limited; use local builds if you exceed them.

## 8. Folder structure

See `README.md` for the annotated tree. Summary:

```
CAM-Center Attendance Monitoring/
├── docs/            # this spec, data model, decisions
├── app/             # TIER 1 — Expo React Native client
│   ├── assets/
│   └── src/
│       ├── screens/     # auth, attendance, roster, reports
│       ├── components/  # reusable UI
│       ├── navigation/  # navigators
│       ├── services/    # apiClient + *Api (call FastAPI); supabaseClient (auth only); syncQueue
│       ├── hooks/       # useAuth, useAttendance, useNetwork
│       ├── context/     # AuthContext
│       ├── utils/       # date, image, csv helpers
│       ├── constants/   # config, theme
│       └── types/       # shared TS types
└── backend/
    ├── api/         # TIER 2 — FastAPI backend (all business logic)
    │   └── app/
    │       ├── main.py        # app factory, CORS, routers
    │       ├── config.py      # env settings
    │       ├── db.py          # Supabase client (service role)
    │       ├── deps.py        # auth dependency → current teacher/admin
    │       ├── core/          # JWT verification
    │       ├── models/        # pydantic schemas
    │       ├── routers/       # people, attendance, reports, admin
    │       └── services/      # attendance, storage, export, retention
    └── supabase/    # TIER 3 — managed data
        ├── migrations/  # 0001_init.sql (schema + RLS)
        └── functions/   # optional edge functions
```

### API endpoints (v1)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | none | liveness |
| GET | `/people` | teacher | list active people |
| POST | `/people` | admin | add person |
| PATCH | `/people/{id}` | admin | edit person |
| DELETE | `/people/{id}` | admin | deactivate person |
| POST | `/attendance` | teacher | log in/out (multipart: fields + selfie) |
| GET | `/attendance/today` | teacher | today's in/out board |
| GET | `/reports/history.csv` | teacher | CSV export by date range |
| POST | `/admin/teachers` | admin | provision a new teacher login (email + admin-assigned password); creates Auth user + `people` + `teacher_accounts` atomically |
| POST | `/admin/purge-selfies` | admin | run retention purge |

## 9. Security & privacy (mandatory — involves minors)

- Selfies of students are sensitive personal data. Obtain **written parental/guardian consent** before capturing any student's image. Keep consent records.
- Restrict all data with Supabase Row-Level Security: only authenticated teacher accounts can read/write; no public access to the `selfies` bucket (signed URLs only).
- Encrypt selfies at rest (Supabase Storage default) and in transit (HTTPS).
- Define and document a **retention policy** (e.g., delete selfies after 90 days; keep only the textual attendance log long-term). Implement as a scheduled purge.
- Do not store selfies on the device longer than needed to sync; clear local cache after upload.
- Provide an admin path to delete a person and all their images on request.
- Comply with the Philippines **Data Privacy Act of 2012 (RA 10173)**: register the purpose, minimize data, secure it, honor deletion requests.

## 10. Milestones

1. **M1 — Setup:** Supabase project + schema migration; FastAPI skeleton (`/health`) deployed; Expo project; Supabase Auth login returning a token the API accepts.
2. **M2 — Roster:** `/people` endpoints + admin screens; search/filter.
3. **M3 — Capture:** `POST /attendance` (selfie upload + timestamp) end-to-end from the camera screen.
4. **M4 — Views:** `/attendance/today` board + History screen with date filter.
5. **M5 — Offline + export:** local queue replaying to the API; `/reports/history.csv` export.
6. **M6 — Hardening:** RLS + API auth review, consent flow, scheduled retention purge, builds + pilot.

## 11. Definition of done (v1)

A teacher can log in, pick any person, check them in/out with a required selfie and automatic timestamp, see today's in/out board, view and export history by date, and have entries captured offline sync automatically — with RLS locking data to teachers and a documented selfie-retention policy in place.

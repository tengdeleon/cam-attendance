# CAM Feature Registry (Developer)

Authoritative inventory of every mobile-app feature: status, client screens, backend
endpoint(s), data touched, and privacy note. Maintained by the `cam-user-manual-manager`
agent — updated in the same PR as any feature added, updated, or removed. Teacher-facing
how-to lives in `docs/user-manual.md`.

Status legend: **Live** · **Removed <date>** · **Planned**.

Last updated: 2026-07-08 (baseline).

---

## Endpoint index (must match `backend/api/app/routers/`)

| Method | Path | Auth | Router | Feature |
|---|---|---|---|---|
| GET | `/health` | none | (app) | Liveness |
| GET | `/people` | teacher | people | Roster list |
| POST | `/people` | admin | people | Add person |
| PATCH | `/people/{id}` | admin | people | Edit person |
| DELETE | `/people/{id}` | admin | people | Deactivate person |
| POST | `/attendance` | teacher | attendance | Check-in/out (multipart + selfie) |
| GET | `/attendance/today` | teacher | attendance | Today board |
| GET | `/attendance/{id}/selfie` | teacher | attendance | Selfie review (signed URL) |
| GET | `/reports/history` | teacher | reports | History rows |
| GET | `/reports/history.csv` | teacher | reports | History CSV export |
| GET | `/reports/period` | teacher | reports | Period report rows |
| GET | `/reports/period.csv` | teacher | reports | Period report CSV |
| POST | `/admin/teachers` | admin | admin | Create teacher account |
| DELETE | `/admin/people/{id}` | admin | admin | Delete person + images |
| POST | `/admin/purge-selfies` | admin | admin | Retention purge |
| GET | `/admin/center-settings` | admin | admin | Read open time / grace |
| PATCH | `/admin/center-settings` | admin | admin | Update open time / grace |

---

## Features

### Auth — Teacher login
- **Status:** Live
- **Screens:** `app/src/screens/auth/LoginScreen.tsx`
- **Endpoints:** Supabase Auth (client-side login → JWT); backend verifies ES256 via JWKS.
- **Data:** `teacher_accounts` (links auth user → person); `is_admin` flag gates admin UI.
- **Privacy:** JWT only; no service-role key on device.

### Roster — People management
- **Status:** Live
- **Screens:** `RosterListScreen.tsx` (browse/search, teacher/student filter),
  `PersonFormScreen.tsx` (add/edit/deactivate — admin).
- **Endpoints:** `GET /people` (teacher); `POST /people`, `PATCH /people/{id}`,
  `DELETE /people/{id}` (admin).
- **Data:** `people` (id, full_name, role, photo_url, is_active).
- **Privacy:** deactivate preserves attendance history; no hard delete here.

### Attendance capture — Check-in/out with selfie
- **Status:** Live
- **Screens:** `CheckInScreen.tsx` (pick person → direction), `CameraScreen.tsx`
  (front-facing capture + confirm).
- **Endpoints:** `POST /attendance` (teacher, multipart: person, direction, device_time,
  selfie).
- **Data:** `attendance` (person_id, direction, selfie_url, logged_by, device_time,
  server_time, sync_status); selfie → `selfies/{yyyy}/{mm}/{dd}/{attendance_id}.jpg`.
- **Rules:** selfie required; server sets `server_time` (source of truth); Manila-local day
  boundaries. Business rules R1/R2/R3 enforced server-side in
  `attendance_service.record_attendance()` (see Attendance validation).
- **Privacy:** §9 surface — minors' images. Selfie compressed ~50–80KB; local copy cleared
  after sync.

### Attendance validation — state rules + missed-checkout (error handling)
- **Status:** Live (branch `feat/attendance-validation`)
- **Screens:** `CheckInScreen.tsx` / `CameraScreen.tsx` (409 handling, missed-checkout
  notice); `FailedQueueScreen.tsx` (visible dropped-on-replay entries).
- **Endpoints:** enforced within `POST /attendance`. Error contract:
  409 `{code:"already_checked_in"}` (R1), 409 `{code:"not_checked_in"}` (R2),
  201 `warnings:[{code:"missed_checkout", date}]` (R3). Client branches on `code`.
- **Data:** reads today's `attendance` rows per person; last-event-per-past-day for missed
  checkout.
- **Rules:** R1 no double check-in; R2 no orphan check-out; R3 missed checkout flagged not
  fixable next day; server is the referee.
- **Privacy:** 409 bodies must not leak another person's data.

### Selfie review — tap-to-view
- **Status:** Live (branch `feat/selfie-review`, merged)
- **Screens:** `TodayScreen.tsx` and `HistoryScreen.tsx` (tappable rows) → `SelfieModal`
  component; `getSelfieUrl(id)` in `services/attendanceApi.ts`.
- **Endpoints:** `GET /attendance/{id}/selfie` (teacher) → `{url, expires_in}`.
- **Data:** signed URL for one attendance record's selfie from the private `selfies` bucket.
- **Privacy:** §9 surface — bucket stays private, short-lived signed URL, image **not**
  persisted on device beyond viewing.

### Today board
- **Status:** Live
- **Screens:** `TodayScreen.tsx`.
- **Endpoints:** `GET /attendance/today` (teacher).
- **Data:** current-day (Manila) in/out state per person.

### History
- **Status:** Live
- **Screens:** `HistoryScreen.tsx` (date filter, tap-to-view selfie).
- **Endpoints:** `GET /reports/history` (teacher).
- **Data:** date-filtered `attendance` rows.

### Reports — CSV export + period report
- **Status:** Live
- **Screens:** `ExportScreen.tsx` (date-range CSV), `PeriodReportScreen.tsx`
  (month + h1/h2/full toggle, missed-checkout column, CSV export).
- **Endpoints:** `GET /reports/history.csv`, `GET /reports/period?month=&period=h1|h2|full`,
  `GET /reports/period.csv` (all teacher).
- **Data:** aggregation over `attendance`; late math from `center_settings`
  (open_time, grace_minutes); row fields: days_present, late_days, late_minutes_total,
  missed_checkouts.
- **Migration:** `0002_reports.sql` (center_settings + views), additive.

### Offline capture + sync queue
- **Status:** Live
- **Screens:** capture path (queues on network failure); `FailedQueueScreen.tsx`.
- **Services:** `services/syncQueue.ts` (expo-sqlite); replays against `POST /attendance`.
- **Rules:** business rejections (4xx) are surfaced, not silently dropped; network failures
  retried.
- **Privacy:** queued selfies cleared after successful sync.

### Admin — accounts, center settings, retention
- **Status:** Live
- **Screens:** admin center-settings form (mirrors `PersonFormScreen` patterns).
- **Endpoints:** `POST /admin/teachers`, `DELETE /admin/people/{id}` (person + images),
  `POST /admin/purge-selfies`, `GET`/`PATCH /admin/center-settings` (all admin).
- **Data:** `teacher_accounts`, `center_settings`, `selfies` bucket.
- **Privacy:** §9 — delete-person path removes images (RA 10173 deletion right); scheduled
  purge enforces retention.

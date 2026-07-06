# CAM — Data Model

Postgres (Supabase). All times stored as `timestamptz` (UTC); display in Asia/Manila.

## Tables

### people
One row per teacher or student. Subject of attendance.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | `gen_random_uuid()` |
| full_name | text NOT NULL | |
| role | text NOT NULL | `teacher` or `student` (CHECK) |
| photo_url | text | reference headshot (optional) |
| is_active | boolean NOT NULL | default true; soft-delete via false |
| created_at | timestamptz NOT NULL | default now() |

### teacher_accounts
Links a Supabase Auth user to a `people` row and grants app access.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| person_id | uuid FK → people.id | the teacher as a person |
| auth_user_id | uuid | = auth.uid() |
| is_admin | boolean NOT NULL | default false |
| created_at | timestamptz NOT NULL | default now() |

### attendance
One row per check-in or check-out event.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| person_id | uuid FK → people.id | who entered/left |
| direction | text NOT NULL | `in` or `out` (CHECK) |
| selfie_url | text NOT NULL | path in `selfies` bucket |
| logged_by | uuid FK → teacher_accounts.id | operating teacher |
| device_time | timestamptz | client clock at capture |
| server_time | timestamptz NOT NULL | default now() — source of truth |
| sync_status | text NOT NULL | `synced` or `pending` (default synced) |

## Storage

Bucket `selfies` (private). Path: `selfies/{yyyy}/{mm}/{dd}/{attendance_id}.jpg`. Access via signed URLs only.

## Access control (two layers)

Primary enforcement is in the **FastAPI backend**: every endpoint requires a valid Supabase JWT, resolves the `teacher_accounts` row, and gates admin actions on `is_admin`. The backend uses the service-role key to reach Postgres/Storage; the client never connects directly.

RLS stays enabled as **defense-in-depth**:

- Enable RLS on all tables.
- `people`, `attendance`: SELECT/INSERT/UPDATE allowed only when a `teacher_accounts` row exists for `auth.uid()`.
- `people` mutations (INSERT/UPDATE) additionally require `is_admin = true`.
- `selfies` bucket: private, no public read; the backend issues short-lived signed URLs.

## Key queries

- **Today's board:** latest `attendance` per `person_id` for current date → derive in/out state.
- **History:** `attendance` filtered by `server_time::date` range, joined to `people`.
- **CSV export:** person name, role, direction, server_time, logged_by name.

See `backend/supabase/migrations/0001_init.sql` for the executable schema.

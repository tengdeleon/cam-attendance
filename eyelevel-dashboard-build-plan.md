# Eye Level Dasmariñas — Dashboard: Data Model & Full-Stack Build Plan (rev. 2)

**Owner:** Teng De Leon (Franchisee / Chief Instructor)
**Goal (dual):** (1) a real operational tool for the center, and (2) a credible full-stack portfolio piece for SWE re-entry.
**Hard constraints:** mobile, selfie-capture clock in/out, **free tools only**.

> **What changed in rev. 2**
> - Track **monthly student enrollment** and **monthly attendance**.
> - **Clock in/out extended to students** (same mechanism as teachers).
> - **Seat allocation removed** from the teacher view.
> - **Roles simplified:** teacher view == owner view, with **one** difference — only the **owner sees center enrollment information**.
>
> **Decisions locked (rev. 3)**
> - **Both teachers and students clock in on their own personal phones** (no center kiosk).
> - **Selfie purge accepted** (60–90 day retention).
> - **Guardian consent accepted** for minors' selfies.
> - **Stack: Spring Boot + keep-warm pinger** (chosen over Supabase-direct).
> - **New:** because students use personal phones with **no account**, each student gets a **device-bound link/QR token** that identifies them. Server never trusts a client-supplied `student_id`; it resolves identity from the signed token. Selfie remains the anti-buddy-punch control.

---

## 1. Scope

One app, mobile-first, two kinds of people clocking in/out: **teachers** and **students**.

Features:
1. **Clock in/out with selfie** — for both teachers and students.
2. **Monthly attendance** — per student (and per teacher), aggregated by calendar month, derived from clock events.
3. **Monthly enrollment tracking** — which students are enrolled each month, in which program, and their status. **Owner-only.**

Roles:
- **Teacher** — sees the roster, runs/views clock in/out for self and students, sees monthly attendance. **Cannot** see enrollment information. No seat allocation.
- **Owner (you)** — everything the teacher sees, **plus** center enrollment information (monthly enrollment counts, status, tuition/enrollment records).

That single gated area (enrollment) is the only difference between the two views.

Out of scope for v1: parent logins, billing automation, push notifications. Schema leaves room for them.

---

## 2. Tech stack — all free

| Layer | Choice | Why | Free tier |
|---|---|---|---|
| **DB + Auth + File storage** | **Supabase** | Postgres + Auth + Storage + Row-Level Security in one free backbone. Selfies go in Storage. | 500 MB DB, 1 GB file storage, 50k monthly active users, 2 projects. Pauses after 1 week *inactivity* (non-issue for daily use). **No auto-backups** — see §9. |
| **Backend API** | **Spring Boot (Java 17)** | Leverages your Java background; server-side logic = the "full stack" credibility. | Free on Render/Koyeb (cold-start caveat below). |
| **Backend hosting** | **Koyeb or Render free web service** | Only real free tiers that run a JVM API. | 512 MB RAM, sleeps after idle → **30s+ cold start**. Mitigation in §10. |
| **Frontend** | **React (Vite) + Tailwind**, as a **PWA** | One codebase, mobile-first, installable, offline-tolerant. | — |
| **Frontend hosting** | **Cloudflare Pages** (or Vercel/Netlify) | Free static hosting, CDN, auto HTTPS, no spin-down. | Free. |
| **Keep-warm pinger** | **cron-job.org** or **GitHub Actions** | Pings backend every ~10 min so no cold start during center hours. | Free. |
| **Source control / CI** | **GitHub + GitHub Actions** | Build/test/deploy + free `pg_dump` backups. | Free. |
| **Local dev** | **Docker Compose** (Postgres) | Local Postgres without touching cloud quota. | Free. |

**Trade-off to confirm (unchanged from rev. 1):** Spring Boot + keep-warm pinger (portfolio-strong, recommended) vs Supabase-direct (simplest, less to show). Recommendation: keep Spring Boot.

---

## 3. Architecture

```
[ Teacher phone (own) ]        [ Student kiosk/tablet at center ]
            \                          /
             \   HTTPS (JWT)          /  selfie JPEG
              v                      v
        [ React PWA on Cloudflare Pages ]
              |  REST/JSON
              v
        [ Spring Boot API on Koyeb/Render ] <-- keep-warm ping (cron-job.org)
              |  JDBC            \-- selfie upload --> [ Supabase Storage ]
              v
        [ Supabase Postgres + Auth (JWT) + Row-Level Security ]
```

**Device note:** **both teachers and students clock in on their own personal phones.** Teachers authenticate with a normal login. Students have **no account** — instead each student opens their **personal device-bound link** (a one-time QR you generate, saved to their home screen). That link carries a signed token the server maps to the student. The server validates the token and resolves `student_id` from it — it never trusts a `student_id` sent by the client. Selfie is still captured on every clock event.

---

## 4. Data model

Postgres. `uuid` PKs, `timestamptz` (store UTC, render Asia/Manila).

### People

```sql
-- App profile, 1:1 with a Supabase auth user (teachers + owner only).
-- Students do NOT get auth logins; they are records, not accounts.
profiles (
  id          uuid PK REFERENCES auth.users(id),
  full_name   text NOT NULL,
  role        text NOT NULL CHECK (role IN ('owner','teacher')),
  phone       text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
)

students (
  id            uuid PK DEFAULT gen_random_uuid(),
  full_name     text NOT NULL,
  birthdate     date,
  guardian_name text,
  guardian_contact text,
  status        text NOT NULL DEFAULT 'active'   -- overall lifecycle
                CHECK (status IN ('active','paused','withdrawn')),
  created_at    timestamptz NOT NULL DEFAULT now()
)

programs (
  id     uuid PK DEFAULT gen_random_uuid(),
  name   text NOT NULL,            -- 'Math', 'English'
  active boolean NOT NULL DEFAULT true
)

-- Per-student device-bound token so a student can clock in on their own
-- phone with NO account. Server stores only the hash; the raw token lives
-- only in the student's saved link/QR.
student_access_tokens (
  id          uuid PK DEFAULT gen_random_uuid(),
  student_id  uuid NOT NULL REFERENCES students(id),
  token_hash  text NOT NULL UNIQUE,       -- SHA-256 of the raw token
  revoked     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
)
```

### Monthly enrollment (OWNER-ONLY)

One row per student, per program, per month. This is the "enrollment information of the center" that only the owner sees.

```sql
monthly_enrollments (
  id            uuid PK DEFAULT gen_random_uuid(),
  student_id    uuid NOT NULL REFERENCES students(id),
  program_id    uuid NOT NULL REFERENCES programs(id),
  period_month  date NOT NULL,           -- first day of month, e.g. 2026-06-01
  level         text,                    -- Eye Level booklet/level that month
  status        text NOT NULL DEFAULT 'enrolled'
                CHECK (status IN ('enrolled','paused','withdrawn')),
  tuition_status text DEFAULT 'unpaid'   -- optional: 'paid','unpaid','partial'
                CHECK (tuition_status IN ('paid','unpaid','partial')),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, program_id, period_month)
)
```

Monthly enrollment **count** = `COUNT(*) WHERE period_month = X AND status='enrolled'` per program — the headline number for the owner dashboard, trendable month over month.

### Clock in/out — teachers AND students (shared table)

One table for both. Exactly one of `teacher_id` / `student_id` is set.

```sql
time_entries (
  id            uuid PK DEFAULT gen_random_uuid(),
  teacher_id    uuid REFERENCES profiles(id),
  student_id    uuid REFERENCES students(id),
  clock_in_at   timestamptz NOT NULL DEFAULT now(),   -- SERVER time
  clock_out_at  timestamptz,                          -- null = still in
  in_selfie_path  text NOT NULL,        -- Supabase Storage key
  out_selfie_path text,
  in_lat numeric, in_lng numeric,       -- optional, off by default
  out_lat numeric, out_lng numeric,
  source_ip     inet,
  status        text NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','closed','edited')),
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT one_subject CHECK (
    (teacher_id IS NOT NULL) <> (student_id IS NOT NULL)  -- exactly one
  ),
  CONSTRAINT out_after_in CHECK (
    clock_out_at IS NULL OR clock_out_at > clock_in_at
  )
)

-- Immutable audit trail for any edit to a time entry.
time_entry_audit (
  id            uuid PK DEFAULT gen_random_uuid(),
  time_entry_id uuid NOT NULL REFERENCES time_entries(id),
  edited_by     uuid NOT NULL REFERENCES profiles(id),
  old_values    jsonb NOT NULL,
  new_values    jsonb NOT NULL,
  reason        text,
  edited_at     timestamptz NOT NULL DEFAULT now()
)
```

### Computed views (not stored)

```sql
-- Monthly attendance per student: distinct days present in a month.
monthly_student_attendance =
  SELECT student_id,
         date_trunc('month', clock_in_at) AS period_month,
         COUNT(DISTINCT date(clock_in_at)) AS days_present
  FROM time_entries
  WHERE student_id IS NOT NULL AND status <> 'open'
  GROUP BY 1, 2;

-- Monthly teacher hours: sum of (clock_out - clock_in).
monthly_teacher_hours =
  SELECT teacher_id,
         date_trunc('month', clock_in_at) AS period_month,
         SUM(clock_out_at - clock_in_at) AS total_hours
  FROM time_entries
  WHERE teacher_id IS NOT NULL AND clock_out_at IS NOT NULL
  GROUP BY 1, 2;
```

### Integrity rules
- **One open entry per person**: partial unique indexes —
  `UNIQUE (teacher_id) WHERE status='open' AND teacher_id IS NOT NULL`, and the same for `student_id`. Prevents double clock-in.
- Time edits never silently UPDATE → DB trigger writes `time_entry_audit` and sets status `edited`.

### Row-Level Security (the simplified role model)
- **`monthly_enrollments`, `programs.tuition` and any enrollment data:** `SELECT/INSERT/UPDATE` for `role='owner'` only. Teachers get **no** access.
- **Everything else** (`students`, `time_entries`, attendance views): readable/writable by **both** `teacher` and `owner`. No per-teacher student restriction — teachers see the whole center roster and all clock data.
- That's the entire difference between the two roles.

---

## 5. API design (Spring Boot REST)

```
GET    /me                       # profile + role

# Students (both roles)
GET    /students                 ?status=
POST   /students
GET    /students/{id}
GET    /students/{id}/attendance ?from=&to=     # monthly attendance

# Teacher clock in/out (authenticated via JWT; subject = self)
POST   /clock-in                 # multipart: selfie  (teacher from JWT)
POST   /clock-out                # multipart: selfie

# Student clock in/out (no account; identity from device-bound token)
POST   /student/clock-in         # multipart: selfie + token  -> server resolves student_id
POST   /student/clock-out        # multipart: selfie + token
POST   /students/{id}/token      # owner/teacher: (re)issue a student's QR link

GET    /clock/today              # who's currently clocked in
GET    /clock/entries            ?subjectType=&subjectId=&from=&to=
PATCH  /clock/entries/{id}       # writes audit row

# Attendance (both roles)
GET    /attendance/monthly       ?month=         # per-student days present

# Enrollment — OWNER ONLY (403 for teacher)
GET    /enrollment/monthly       ?month=         # roster + status + counts
POST   /enrollment/monthly       # set a student's enrollment for a month
GET    /enrollment/trend         ?from=&to=      # month-over-month counts
```

Server responsibilities: JWT validation, **owner-only enforcement on `/enrollment/*`**, server-authoritative timestamps, selfie compression/upload, audit writes, monthly aggregation.

---

## 6. Selfie clock in/out flow (teachers + students)

1. **Teacher:** opens PWA (logged in) → **Clock In**. **Student:** opens their saved personal link/QR on their own phone → app loads with their token → **Clock In**.
2. Camera (`getUserMedia`) → capture frame → compress to ~720px JPEG (~50–100 KB).
3. Teacher → `POST /clock-in` (identity from JWT). Student → `POST /student/clock-in` with selfie + token; **server resolves `student_id` from the token hash**, never from client input.
4. Server: reject if that person already has an open entry → upload selfie to `selfies/{type}/{id}/{ts}.jpg` → insert `time_entries` with **server `now()`** → update `student_access_tokens.last_used_at`.
5. **Clock Out** mirrors it, computes hours / marks attendance.
6. Teacher or owner can review entries with selfie thumbnails.

Storage math: ~100 KB × 2 per visit. Students drive most volume — e.g. 80 students × 12 visits/month × 200 KB ≈ 190 MB/month. **This will approach the 1 GB cap within ~5 months**, so a retention purge (e.g. delete selfies > 60–90 days, keep the attendance row) is **required**, not optional. See §9.

---

## 7. Frontend (mobile-first PWA)

- **React + Vite + Tailwind**; `vite-plugin-pwa` (installable, offline-tolerant).
- **Three surfaces, same build:**
  - **Teacher phone (logged in):** clock self in/out, view roster + monthly attendance.
  - **Owner (logged in):** identical, plus an **Enrollment** section (monthly counts, status, trend) that teachers don't see.
  - **Student phone (no login, token link):** minimal screen — their name + Clock In/Out + selfie. Nothing else exposed.
- **Offline tolerance:** queue clock events if wifi drops; sync on reconnect (service worker + IndexedDB). Server still stamps authoritative time on sync.
- **Charts:** Recharts/Chart.js — attendance trend, enrollment trend (owner).
- **No seat allocation / capacity view** anywhere (removed).

---

## 8. Auth & roles

- Supabase Auth (email + password) for **teachers and owner only**. Students are records, not accounts.
- **Students authenticate by possession:** a device-bound token (saved link/QR) maps to one student. Server stores only the SHA-256 hash; raw token lives only on the student's phone. Owner/teacher can **revoke + reissue** if a phone is lost. Token scope is intentionally tiny — it can only clock that one student in/out, nothing else.
- `profiles.role` drives the one gate: `/enrollment/*` and the Enrollment UI are owner-only, enforced in both Spring Boot and Postgres RLS.
- Owner creates teacher accounts. No self-registration.

---

## 9. Security & privacy (non-negotiable — minors involved)

- **RA 10173 (PH Data Privacy Act):** selfies of **minor students** are sensitive. Get **guardian consent** for student selfie-attendance, and staff consent for teachers. Document purpose + retention. Consider making the student selfie optional/low-res if guardians object — attendance can still log without it.
- **Retention purge is mandatory** here (student selfie volume hits the 1 GB cap): scheduled job deletes selfies older than 60–90 days; attendance/time rows stay.
- **HTTPS only**; JWT expiry + refresh; short session on the shared kiosk especially.
- **No automated Supabase backups** → weekly `pg_dump` via free GitHub Action to a private store.
- **Immutable audit trail** on time edits (teacher hours feed pay; disputes happen).
- **RLS on by default** so a leaked key can't expose enrollment or student data.

---

## 10. Phased build plan

**Phase 0 — Foundations (wknd 1):** repo + CI, Supabase project (DB/Auth/Storage), Spring Boot scaffold with JWT validation, React+Vite+Tailwind PWA shell, hello end-to-end deploy.

**Phase 1 — Auth, schema, roles (wknd 2):** all migrations + RLS (enrollment owner-only), owner creates teacher accounts, login on mobile, seed data.

**Phase 2 — Clock in/out, both subjects (wknd 3):** camera capture + compression, clock in/out for teachers and students, one-open-entry rule, kiosk roster screen, review screen with thumbnails, audit trail.

**Phase 3 — Attendance (wknd 4):** monthly attendance views per student + per teacher, attendance trend charts, offline queue + sync.

**Phase 4 — Enrollment (owner-only) (wknd 5):** monthly enrollment records, monthly counts + month-over-month trend, tuition status (optional), owner-only gating verified end-to-end.

**Phase 5 — Hardening + portfolio (wknd 6):** retention purge job, keep-warm pinger, weekly backup Action, README with architecture + decisions, demo on **seeded/anonymized** data (never real minors' data publicly), short walkthrough.

---

## 11. Free-tier limits & risks

| Risk | Impact | Mitigation |
|---|---|---|
| Student selfie volume vs 1 GB Storage | Cap hit in months | Compress + **mandatory 60–90 day purge** |
| Backend cold start (free host) | 30s+ first request | Keep-warm cron ping during center hours |
| No Supabase auto-backup | Data loss | Weekly `pg_dump` GitHub Action |
| Supabase pause after 1 wk idle | DB sleeps | Daily use + keep-warm ping |
| 500 MB DB cap | Eventually tight | Text data is tiny; selfies live in Storage, not DB |
| Minors' selfies | Privacy/legal | Guardian consent; optional/low-res selfie; short retention |
| Daekyo/MyLearning ToS | No official feed | This is **your** system of record; don't scrape theirs |

---

## 12. Local dev

`docker compose up` → local Postgres (no cloud quota). Flyway/Liquibase migrations (versioned schema = portfolio plus). Spring profiles `local` vs `prod`. `.env` for keys, never committed.

---

## Immediate next step

Confirm the §2 stack trade-off (**Spring Boot + keep-warm**, recommended, vs Supabase-direct). On confirmation I'll generate: the SQL migration (all tables + RLS incl. owner-only enrollment), the Spring Boot skeleton, and the React PWA shell with the kiosk clock-in screen.

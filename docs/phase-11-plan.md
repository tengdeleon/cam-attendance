# Phase 11 Plan — Reports + Face-Recognition Check-In

Status: planning. CAM v1 is done (Checkpoint 10, 2026-07-07). This plan revises the
original Phase 11 ("Eye Level Dashboard merge"). Decisions locked 2026-07-07:

- Lateness = **center-wide fixed open time + grace window**.
- Report delivery = **in-app screen + CSV export**.
- Face recognition = **design now, flag blockers** (build gated on consent + hosting spike).
- Student self clock-in = **deferred** (out of this phase).

Build the two tracks independently. Track A (reports) ships on its own migration and
does not depend on Track B. Do **not** bundle them — Track B's legal/hosting blockers
would otherwise stall the reports.

---

## Track A — Bi-monthly attendance reports

### A.1 What it produces

Two reporting periods per month:

| Period | Days covered | Complete on |
|---|---|---|
| Half 1 | 1st – 15th | the 15th |
| Half 2 | 16th – end of month | last day of month |

Per **teacher** (`role = 'teacher'`), for the selected period:

- days present (distinct days with at least one check-in),
- late days (days where the first check-in is after open + grace),
- total late minutes,
- per-day breakdown of late minutes.

Audience: any authenticated teacher can view. Subjects: teachers only (students
excluded from this report).

### A.2 Lateness model (locked: fixed time + grace)

New singleton config the admin can edit without redeploy:

```
center_settings (
  id            int primary key default 1 check (id = 1),  -- single row
  open_time     time not null default '08:00',
  grace_minutes int  not null default 10,
  tz            text not null default 'Asia/Manila'
)
```

Computation, per teacher per local day (Manila):

1. `first_in` = earliest `attendance.server_time` with `direction = 'in'` that day,
   converted to `tz`.
2. `official_start` = that day's date at `open_time`.
3. `cutoff` = `official_start` + `grace_minutes`.
4. If `first_in > cutoff` → the day is a **late day**.
5. `late_minutes` = `first_in − official_start`, in whole minutes (measured from the
   official start, **not** from end of grace — grace only decides *whether* the day
   counts as late). This convention is a one-line change if you later want minutes
   measured from the cutoff instead.

Days with no check-in are simply absent from "days present" — this report does not
assert absence (no roster-wide expected-attendance calendar in v1).

### A.3 Data / backend

- **Migration `0002_reports.sql`** (additive): create `center_settings`, seed the
  default row; create a helper view for daily first-in:

  ```sql
  create view v_daily_first_in as
  select person_id,
         (server_time at time zone 'Asia/Manila')::date as local_day,
         min(server_time at time zone 'Asia/Manila')    as first_in_local
  from attendance
  where direction = 'in'
  group by person_id, local_day;
  ```

  (Timezone read from `center_settings.tz` at query time in the service rather than
  hard-coded, so the view is a convenience only; final aggregation lives in the
  service to keep the period math in one place.)

- **Service** `reports_service.period_report(month, half)`:
  resolves the date window, joins `v_daily_first_in` → `people` (role='teacher') →
  `center_settings`, computes the fields in A.2, returns rows + per-day detail.

- **Endpoints**:

  | Method | Path | Auth | Purpose |
  |---|---|---|---|
  | GET | `/reports/period?month=YYYY-MM&half=1\|2` | teacher | JSON rows |
  | GET | `/reports/period.csv?month=YYYY-MM&half=1\|2` | teacher | CSV export |
  | GET | `/admin/center-settings` | admin | read open_time/grace |
  | PATCH | `/admin/center-settings` | admin | update open_time/grace |

  No scheduled job needed — delivery is in-app + CSV, so the report is computed on
  demand for any past period.

### A.4 Client

- **ReportsScreen** (extend `screens/reports`): month picker + half toggle
  (`1–15` / `16–EOM`); table columns *Teacher · Days present · Late days · Total late
  min*; row expands to per-day late minutes. Reuse the existing CSV path
  (`apiText` → `expo-file-system/legacy` → `expo-sharing`) for the Export button.
- **Admin settings**: a small form to set open time + grace (admin-gated), reusing the
  PersonForm patterns.

### A.5 Effort / risk

Low risk, contained. The only genuinely new concept is `center_settings`; everything
else reuses existing Manila-date helpers, CSV export, and auth. Ship this first.

---

## Track B — Selfie/groufie + face-recognition check-in (design; build gated)

Teacher-operated: the teacher takes a single photo (one person or a group), the
backend detects and identifies the faces, proposes who to check in/out, and the
teacher confirms. This does **not** depend on student self-clock-in.

### B.1 Flow

1. Teacher opens capture, takes a **groufie** (front camera, one or many faces).
2. `POST /attendance/recognize` (multipart: image + auth token).
3. Backend: detect all faces → embed each → for each embedding, nearest-neighbor
   match against enrolled templates (pgvector) within a distance threshold →
   candidate `person_id` + confidence.
4. For each matched person, propose a direction = opposite of their last-known state
   that day (checked-in → propose "out"; not in → propose "in").
5. Backend returns a list: `{person_id, name, role, confidence, suggested_direction}`.
6. **Confirm screen** (mandatory): teacher sees tagged names with in/out toggles, can
   deselect, correct a direction, or add a person the model missed. **Never
   auto-commit.**
7. On confirm → backend inserts one `attendance` row per selected person, server sets
   timestamps, stores the per-person face crop (preferred) or the shared groufie as
   the selfie of record.

### B.2 The edge rule (student check-in with an already-checked-in teacher in frame)

Generalize the requested behavior into a pre-selection rule on the confirm screen:

- Pre-select for check-**in**: matched people who are **not** currently checked in.
- Pre-**skip** (toggle off): anyone already checked in today — this covers "the
  teacher is in the photo but already checked in, ignore them."
- The teacher can still override any toggle before committing.

This keeps the rule declarative and auditable rather than hard-coding "teachers are
ignored," which would break when a teacher genuinely checks out.

### B.3 Enrollment + data

- **Enrollment**: each person gets 1–3 reference photos at onboarding → compute
  embedding(s) → store. New table (own migration `0003_face.sql`, keeps reports
  unblocked):

  ```
  face_embeddings (
    id           uuid pk,
    person_id    uuid fk -> people,
    embedding    vector(512),         -- pgvector; 512 for InsightFace, 128 for dlib
    model_version text not null,
    source_path  text,                -- reference image in storage
    created_at   timestamptz default now()
  )
  ```

  Enable the **pgvector** extension on Supabase (free). Index with `ivfflat`/`hnsw`
  on `embedding` for fast nearest-neighbor.

- **Model** (free-only): `InsightFace` buffalo_l (ArcFace, 512-d, ONNX) — stronger on
  children's faces than dlib but heavier; or `face_recognition`/dlib (128-d) — lighter
  build, weaker accuracy. Pick after the hosting spike (B.4).

- **Deletion**: the existing "delete a person + all images" admin path must also delete
  their `face_embeddings` rows — templates are biometric data.

### B.4 Blockers — resolve before writing code

1. **Legal / consent (highest priority).** Face templates are **biometric data** =
   *sensitive personal information* under RA 10173, and these are **minors**. v1's spec
   (§2) deliberately excluded face-rec for this reason, and the current consent form
   only covers "selfie for human verification." Required before any enrollment:
   - a **new consent addendum** explicitly authorizing facial-template extraction,
     storage, and matching, per student, with guardian signature;
   - update `docs/privacy-and-retention.md` — purpose, template retention period, and
     deletion path;
   - register the expanded purpose per RA 10173 (data minimization + security).
   This is a policy decision, not a coding task, and it gates everything else.

2. **Hosting / compute (may break "free-only").** InsightFace/onnxruntime or dlib on
   Render free (~512 MB RAM, shared CPU) will likely OOM or run slowly under load.
   Options to evaluate in a spike:
   - (a) server-side inference on Render free — measure peak RAM + latency for a
     3–5 face groufie; may not fit;
   - (b) on-device inference in Expo (RN ML is limited; tflite/mediapipe possible but
     complex) — keeps compute off the server;
   - (c) accept a paid Render tier — **breaks the free-tier constraint**, decide
     explicitly.
   Do this spike before committing a model choice.

3. **Accuracy on minors.** Children's faces drift fast → templates go stale (plan
   periodic re-enrollment, e.g. every N months); siblings/look-alikes raise false
   matches; lighting at the entrance varies. Mitigations baked into the design: the
   mandatory confirm screen (no silent commit), a tuned distance threshold with an
   "unrecognized → manual pick" fallback, and confidence shown to the teacher.

### B.5 Sequencing

```
0002 reports (ship) → consent addendum + hosting spike (go/no-go)
                    → 0003 face tables (pgvector) → /recognize endpoint → confirm screen
```

If the spike says free-tier server inference doesn't fit and on-device is too costly,
Track B stalls at a real decision point (pay for hosting, or shelve face-rec). That's
expected — surfacing it now is the point.

---

## Deferred (not this phase)

- **Student self clock-in** (token/QR, public `/s/:token` screen). Highest
  security surface; revisit after Tracks A/B.
- Owner-only enrollment/tuition, immutable audit trail, and the broader Dashboard
  merge from the original Phase 11 table remain future work.

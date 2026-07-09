# Attendance Validation + Missed-Checkout Reports — Agent Workflow Runbook

Step-by-step guide to building the **attendance state validation** feature using the CAM
agent team. Companion to `docs/agents.md` (agent design) and
`docs/selfie-review-agent-workflow.md` (the same flow applied to the selfie-review
feature, which is already implemented on `feat/selfie-review` — use that doc as the
worked example; this doc is the operational script for THIS feature).

Last updated: 2026-07-08.

---

## 1. The feature, precisely

Four rules, all new:

| # | Rule | Example |
|---|---|---|
| R1 | **No double check-in.** A check-in is rejected if the person already has an open check-in today. | Teacher A checks in 8:00 AM → a second check-in at 8:05 AM is rejected with a clear error. |
| R2 | **No orphan check-out.** A check-out is rejected if the person has no open check-in today. | Teacher A never checked in today → check-out attempt is rejected. |
| R3 | **Missed checkout is flagged, not fixable next day.** If the person's last event on a *previous* day was an unclosed check-in: today's **check-in is allowed** but the app notifies the teacher ("no check-out recorded on <date>"); a **check-out against yesterday's open check-in is NOT allowed** (R2 already blocks it — there is no check-in *today*). The missed day stays permanently flagged. | Teacher A checked in Mon 8 AM, forgot to check out. Tue: check-in works + shows the warning; a bare Tue check-out is rejected. |
| R4 | **Missed checkouts appear in reports.** The bi-monthly (1–15 / 16–EOM) and **monthly** attendance reports show a missed-checkout count per teacher alongside days present / late days / late minutes. | Report row: `Teacher A · 10 days · 2 late · 34 min · 1 missed checkout`. |

R4 pulls in **Phase 11 Track A** (`docs/phase-11-plan.md`), which is not yet built — the
bi-monthly report, `center_settings`, and migration `0002_reports.sql` get built in this
same feature, extended with (a) a `missed_checkouts` column and (b) a full-month period
option. Scope decision made 2026-07-08: one feature branch delivers validation + full
reports together.

Definitions the whole feature hangs on (sanity-check the plan against these):

- **"Open check-in today"** = the person's latest attendance event within the current
  **Manila-local day** (`manila_day_bounds` in `attendance_service.py`) has
  `direction = 'in'`. Day boundaries are Manila, never UTC — this was already fixed once
  in `today_board()`; don't regress it.
- **"Missed-checkout day"** = a past Manila-local day where the person has ≥1 `'in'`
  and the day's **last** event is `'in'` (no closing `'out'`).
- **Server is the referee.** All four rules are enforced in
  `backend/api/app/services/attendance_service.record_attendance()` — the client-side
  direction toggle is UX sugar and can be stale or offline; it must never be the only
  guard.

---

## 2. What "the agents" are and where you drive them

Five project subagents live in `.claude/agents/`, invoked from your **main Claude Code
session** (the orchestrator). You never run an agent from a shell — you *delegate* in
chat, either by naming the agent ("use `cam-planner` to…") or by describing work that
matches its `description` so Claude auto-routes.

| Agent | Model | Writes? | Job in this feature |
|---|---|---|---|
| `cam-planner` | sonnet | plan file only | Produce `docs/plans/attendance-validation.md` — error contract + report contract + migration + file list |
| `cam-backend-dev` | sonnet | `backend/` | Validation in `record_attendance`, migration `0002_reports.sql`, `reports_service`, new endpoints |
| `cam-mobile-dev` | sonnet | `app/src` | 409 handling + missed-checkout notice in CheckInScreen, offline-queue rejection notice, PeriodReportScreen |
| `cam-qa` | haiku | nothing | pytest / tsc / gitleaks; failures only |
| `cam-reviewer` | sonnet | nothing | Data-integrity + auth review of the diff (mandatory — this changes attendance semantics and adds a migration) |

Every command below is tagged with its execution surface:

- **[MAIN SESSION]** — typed into the Claude Code chat (delegations, `/agents`,
  SendMessage follow-ups).
- **[TERMINAL]** — typed into a real shell at the repo root. Only git, the two dev
  servers, and reading plan files. The dev agents run their own build checks internally
  via their Bash tool — you never run those yourself.
- **[BROWSER]** — Supabase dashboard (applying the SQL migration) or GitHub (PR).

Repo root for all **[TERMINAL]** steps:
`/Users/ethelbertdeleon/Eye Level/Claude/CAM-Center Attendance Monitoring`

---

## 3. Why this feature needs the full pipeline

Per `docs/agents.md §2`, anything multi-file or cross-tier goes
planner → dev(s) → qa → reviewer → commit. This feature qualifies three times over:

1. **Both tiers change** — backend validation + reports, client error UX + a new screen.
2. **A schema migration ships** (`0002_reports.sql`: `center_settings`, first-in and
   missed-checkout views). Migrations are additive-only and irreversible once applied —
   exactly what `cam-reviewer`'s data-integrity checklist item exists for.
3. **It changes attendance semantics.** Requests that used to succeed will now 409. The
   offline queue currently **silently drops any 4xx** during replay (`syncQueue.ts`) —
   with these new 409s, a teacher's queued check-in can vanish without a trace unless
   the client is taught to surface dropped items. That interaction is the highest-risk
   part of this feature; it must be in the plan.

Technical shape to sanity-check the plan against:

**Error contract (backend → client), machine-readable codes:**

```
POST /attendance  → 409 {"detail": {"code": "already_checked_in",
                                    "message": "Already checked in today at 08:00."}}
POST /attendance  → 409 {"detail": {"code": "not_checked_in",
                                    "message": "No open check-in today; check in first."}}
POST /attendance  → 201 {..., "warnings": [{"code": "missed_checkout",
                                            "date": "2026-07-07"}]}   # R3 notify
```

The client branches on `code`, never on the message text. The 201 `warnings` array is
how R3's notification travels — no extra round-trip, no new status endpoint.

**Report contract:**

```
GET /reports/period?month=YYYY-MM&period=h1|h2|full      → JSON rows (teacher auth)
GET /reports/period.csv?month=YYYY-MM&period=h1|h2|full  → CSV export (teacher auth)
GET /admin/center-settings                               → read open_time/grace (admin)
PATCH /admin/center-settings                             → update (admin)
```

`period=h1` = 1st–15th, `h2` = 16th–EOM, `full` = whole month (this `full` value is the
extension beyond the Phase 11 plan, which only had `half=1|2`). Row fields:
`teacher, days_present, late_days, late_minutes_total, missed_checkouts`, plus per-day
detail. Lateness math exactly as `docs/phase-11-plan.md §A.2` (grace decides *whether*
late; minutes measured from official start).

**Migration `0002_reports.sql`** (new file in `backend/supabase/migrations/`, additive):
`center_settings` singleton (open_time, grace_minutes, tz — per Phase 11 A.2),
`v_daily_first_in` (per Phase 11 A.3), and a missed-checkout source — either a
`v_daily_last_event` view (last direction per person per Manila day; missed = past day
whose last direction is `'in'`) or equivalent aggregation in `reports_service`. The
planner picks; the R1/R2/R3 checks themselves are plain queries inside
`record_attendance` (today's rows for one person — cheap), not views.

**Client:**

- `CheckInScreen` / `CameraScreen` path: catch 409, show the human message, do **not**
  queue a 409-rejected request (it's a business rejection, not a network failure —
  the existing `ApiError` vs network-error split in `CameraScreen` already makes this
  distinction; extend, don't rework).
- Show the `missed_checkout` warning after a successful check-in (alert or banner).
- `syncQueue.ts`: when replay drops an item on 4xx, record it and surface a notice
  ("1 queued entry was rejected: Teacher A check-in — already checked in") instead of
  silent disappearance. Smallest viable: a dropped-items log the banner in
  `CheckInScreen` can read.
- New `PeriodReportScreen` under `screens/reports`: month picker + h1/h2/full toggle,
  table (Teacher · Present · Late · Late min · **Missed CO**), Export button reusing
  the existing CSV path (`apiText` → `expo-file-system/legacy` → `expo-sharing`).
- Admin form for open time + grace (mirror `PersonFormScreen` patterns).

---

## 4. Pre-flight — branch state + agent check

The repo currently sits on `feat/selfie-review` with the selfie feature committed and
pushed (`f851be2`). Land it before starting this feature so the new branch cuts from a
clean main.

**[BROWSER]** Open the PR for `feat/selfie-review` on
`github.com/tengdeleon/cam-attendance` and merge it (CI secret-scan backstop runs there).

**[TERMINAL]** Then, one command at a time:

```bash
cd "/Users/ethelbertdeleon/Eye Level/Claude/CAM-Center Attendance Monitoring"
```

```bash
git checkout main
```

```bash
git pull
```

```bash
git status
```

(expect: clean — the stray `.claude/settings.local.json` is untracked and ignorable)

```bash
ls .claude/agents
```

(expect: `cam-backend-dev.md cam-mobile-dev.md cam-planner.md cam-qa.md cam-reviewer.md`)

```bash
git checkout -b feat/attendance-validation
```

**[MAIN SESSION]** Verify Claude sees the agent team:

```
/agents
```

All five `cam-*` agents must be listed. If not, Claude Code isn't open at the repo root.

---

## 5. Step 1 — Plan (cam-planner)

**[MAIN SESSION]** One delegation, containing the rules and both contracts as
constraints — let the agent read the code and fix exact files:

```
Use cam-planner: plan the "attendance validation + missed-checkout reports" feature.
Write the plan to docs/plans/attendance-validation.md.

Rules to enforce server-side in record_attendance (Manila-local days via
manila_day_bounds; server is the referee, client toggle is only UX):
R1 reject check-in when the person's latest event today is 'in'
   (409, code "already_checked_in").
R2 reject check-out when the person has no open check-in today
   (409, code "not_checked_in").
R3 when a successful check-in follows a previous day whose last event was an
   unclosed 'in', return warnings:[{code:"missed_checkout", date:"YYYY-MM-DD"}]
   in the 201 body — notify only; never allow closing a previous day's check-in.
R4 reports: build Phase 11 Track A (docs/phase-11-plan.md A.1–A.4) now, extended
   with (a) a missed_checkouts column per teacher and (b) period=h1|h2|full where
   full = whole month. Endpoints /reports/period and /reports/period.csv (teacher),
   /admin/center-settings GET+PATCH (admin). Migration 0002_reports.sql, additive.

Client constraints: 409s are business rejections — show the message, never queue
them; syncQueue currently drops 4xx silently on replay — dropped items must become
visible to the teacher; missed_checkout warning surfaces after check-in; new
PeriodReportScreen reuses the existing CSV export path.

Fix the API error contract and report contract first so backend and mobile build in
parallel. Flag the offline-queue interaction as a named risk.
```

**What comes back:** the plan path + a ≤5-line summary only (by design).

**[TERMINAL]** Read the plan yourself before spending dev tokens:

```bash
sed -n '1,250p' docs/plans/attendance-validation.md
```

Gate check — the plan must contain, or it goes back:

- the **exact 409 bodies** (codes `already_checked_in`, `not_checked_in`) and the 201
  `warnings` shape;
- the **report row schema** including `missed_checkouts`, and `period=h1|h2|full`
  window math;
- `0002_reports.sql` contents sketched (center_settings seed row, views), **additive
  only**;
- **Files to touch** with exact paths on both tiers;
- a **Risks** section naming the offline-queue silent-drop interaction and the
  Manila-day boundary;
- a **Test checklist** for `cam-qa`.

If anything is missing, send it back to the *same* agent — don't respawn:

```
Use cam-planner (SendMessage, same agent): the plan is missing <X>. Add it and
update docs/plans/attendance-validation.md in place.
```

---

## 6. Step 2 — Apply the migration (you, manually)

The dev agents cannot touch your Supabase project — applying SQL is a human step, and
it must happen **before** the backend smoke test can pass against real data.

**[TERMINAL]** After `cam-backend-dev` writes the migration file in the next step you
will display it; but the *sequence* decision is made now: the plan's migration section
is what gets applied, so confirm it at plan-gate time.

**[BROWSER]** When the migration file exists (after Step 3's backend agent finishes):
Supabase dashboard → project `cjdllpizedemzbrlfspv` → **SQL Editor** → paste the full
contents of `backend/supabase/migrations/0002_reports.sql` → **Run**. Verify:

- Table Editor shows `center_settings` with exactly one row (`open_time 08:00`,
  `grace_minutes 10`, `tz Asia/Manila`);
- the views exist (Database → Views).

Never edit `0001_init.sql`; `0002` is a new file, applied once.

---

## 7. Step 3 — Build both tiers in parallel

The plan fixed both contracts, so the tiers can't drift. **[MAIN SESSION]** — issue both
delegations **in the same turn** so they run concurrently:

```
Use cam-backend-dev: implement the backend section of
docs/plans/attendance-validation.md — R1/R2/R3 validation in record_attendance
(Manila-day queries, 409 codes and 201 warnings exactly per the plan's contract),
migration 0002_reports.sql, reports_service with period=h1|h2|full and
missed_checkouts, /reports/period[.csv] and /admin/center-settings endpoints.
Smallest diff. Run the scoped pytest before returning.
```

```
Use cam-mobile-dev: implement the client section of
docs/plans/attendance-validation.md — 409 handling in the check-in flow (show
message, never queue business rejections), missed_checkout warning after
successful check-in, visible notice for items syncQueue drops on 4xx replay,
PeriodReportScreen (month + h1/h2/full, missed-checkout column, CSV export via
the existing path), admin center-settings form. Run tsc --noEmit before returning.
```

**What comes back from each:** changed-file paths (one line each) + its own build-check
result. No code dumps. `cam-backend-dev` runs `python -m pytest -q -k …` itself;
`cam-mobile-dev` runs `npx tsc --noEmit` itself — you do **not** run those.

> Sequencing note: if mid-build one side needs a contract change (e.g. the warnings
> shape), stop, amend the plan via `cam-planner` (SendMessage), then resume **both**
> dev agents from the amended plan via SendMessage. Never let the sides drift
> (`docs/agents.md §5.7`).

Now perform **Step 2's [BROWSER] action** — apply `0002_reports.sql` in the Supabase
SQL Editor — before the smoke test in Step 6.

---

## 8. Step 4 — Verify (cam-qa)

**[MAIN SESSION]** Cheapest agent, full changed scope:

```
Use cam-qa: verify scope = backend attendance service/router, reports service/router,
admin router, migration file; app/src check-in flow, syncQueue, reports screens.
Run backend pytest, the import smoke test (python -c "from app.main import app"),
app tsc --noEmit, and gitleaks at repo root. Also spot-check spec conformance:
selfie still required on POST /attendance, server_time still set server-side,
0001_init.sql untouched. Report failures only.
```

**Expected:** one line per check, ending `VERDICT: PASS`.

**On `VERDICT: FAIL`** — do not re-plan, do not respawn. Send only the failing lines to
the *same* dev agent (warm context):

```
Use cam-backend-dev (SendMessage, same agent): cam-qa failed —
<paste only the failing test names + ≤10-line excerpts>.
Fix with the smallest diff and re-run the scoped pytest.
```

Re-run `cam-qa` on the same scope. Loop until PASS.

---

## 9. Step 5 — Review (cam-reviewer) — mandatory

This feature rewires attendance capture semantics and ships a migration — squarely
inside the reviewer's blocking scope (auth, capture, migrations, exports).
**[MAIN SESSION]:**

```
Use cam-reviewer: review the diff for attendance validation + reports
(git diff main...HEAD). Focus: R1/R2 enforced server-side and not bypassable by
direct API calls; Manila-day (not UTC) boundaries in every new query; 409s carry no
other person's data; the offline queue surfaces dropped items instead of silently
losing attendance; migration 0002 additive, RLS not weakened, center_settings
PATCH admin-only; /reports endpoints behind teacher auth; CSV export leaks nothing
beyond the report fields; types in sync backend<->client. Findings only.
```

**Expected:** findings ordered BLOCKER / WARN / NIT, ending `REVIEW: APPROVE` or
`REVIEW: BLOCK (<n>)`.

**On BLOCK:** route each blocker to the tier that owns it via SendMessage
(backend → `cam-backend-dev`, client → `cam-mobile-dev`), re-run `cam-qa` on the touched
scope, then re-run `cam-reviewer`. Anything touching data integrity of attendance
records is blocking even if marked WARN.

---

## 10. Step 6 — Manual smoke test

Automated checks can't prove the UX. Run the app and walk the rules. **[TERMINAL]**,
two shells from the repo root:

```bash
# shell 1 — backend
cd backend/api && source .venv/bin/activate && uvicorn app.main:app --reload --host 0.0.0.0
```

```bash
# shell 2 — client (API base URL must be the LAN/hotspot IP, not localhost —
# startDevCAM.command handles the .env rewrite, or check app/.env manually)
cd app && npx expo start
```

Then in Expo Go, in this order (use a test person, not real data):

1. **R1:** check the person in → immediately try a second check-in → expect the
   "already checked in" message, **no** second record in History, nothing queued.
2. **R2:** pick a person who has not checked in today → try check-out → expect the
   "no open check-in" message.
3. **Normal close:** check the person out → succeeds.
4. **R3:** needs an unclosed check-in on a *previous* day. Fake it: Supabase
   **[BROWSER]** Table Editor → `attendance` → edit a test person's lone `'in'` row's
   `server_time` to yesterday (Manila). Then in the app: check that person in today →
   expect success **plus** the missed-checkout notice naming yesterday's date; then
   confirm a bare check-out (without today's check-in) for another such person is
   rejected.
5. **Offline drop visibility:** airplane mode → check someone in (queues) → go online
   with the person already checked in (replay will 409) → expect a visible
   "entry rejected" notice, not silence.
6. **R4:** open the report screen → current month, `full` → the test person's
   missed-checkout day counts; switch h1/h2 → windows correct; Export CSV → columns
   include missed checkouts; verify late-day math against `center_settings`
   (08:00 + 10 min default).
7. Revert any `server_time` edits / delete test rows in the Table Editor.

---

## 11. Step 7 — Commit & push

Only after `VERDICT: PASS` **and** `REVIEW: APPROVE` **and** a clean smoke test.
**[TERMINAL]:**

```bash
cd "/Users/ethelbertdeleon/Eye Level/Claude/CAM-Center Attendance Monitoring"
```

```bash
git add -A
```

```bash
git status
```

(eyeball the file list against the plan's "Files to touch")

```bash
git commit -m "feat(attendance): state validation (no double in/out) + missed-checkout flag + bi-monthly/monthly reports"
```

```bash
git push -u origin feat/attendance-validation
```

The `.githooks/pre-commit` gitleaks hook (fail-closed) runs on commit; if it blocks,
there is a secret in the diff — fix it, never bypass. **[BROWSER]** Open the PR; the CI
backstop re-runs the secret scan; merge. Render auto-deploys `main` — remember the
free-tier cold start (~30 s) when you verify `https://cam-api-38sv.onrender.com/health`
afterwards, and that the **migration must already be applied** in Supabase before the
deployed code serves report requests.

---

## 12. The whole flow at a glance

```
[BROWSER]   merge feat/selfie-review PR
[TERMINAL]  main → pull → branch feat/attendance-validation → /agents check
     │
[MAIN] cam-planner ──► docs/plans/attendance-validation.md   (fix error + report contracts)
     │  (you read + gate the plan)
     ├───────────────┬──────────────────────────────  parallel, same contracts
[MAIN] cam-backend-dev             [MAIN] cam-mobile-dev
   R1/R2/R3 in record_attendance      409 UX + missed-checkout notice
   0002_reports.sql + reports svc     syncQueue drop visibility
   /reports/period[.csv]              PeriodReportScreen + admin form
     └───────────────┴──────────────────────────────
[BROWSER]  apply 0002_reports.sql in Supabase SQL Editor
     │
[MAIN] cam-qa ──► VERDICT: PASS / FAIL
     │   FAIL → SendMessage same dev agent (failing lines only) → re-qa
[MAIN] cam-reviewer ──► REVIEW: APPROVE / BLOCK   (integrity findings block)
     │   BLOCK → SendMessage owning dev agent → re-qa → re-review
[TERMINAL]  manual smoke test — walk R1..R4 + offline drop
[TERMINAL]  git commit (gitleaks hook) + push → PR → merge → Render deploy
```

## 13. Rules that keep this cheap and correct

1. **Never run an agent's build commands yourself** — dev agents self-verify; you run
   only git, the two dev servers, and the Supabase SQL Editor.
2. **Rework = SendMessage to the same agent**, never a fresh spawn — warm context;
   a respawn re-derives everything cold.
3. **Hand off through files** (plan path, qa verdict lines, reviewer findings) — never
   paste code or full logs between steps.
4. **Fix the contracts before parallelizing.** One source of truth
   (`docs/plans/attendance-validation.md`); changes go through `cam-planner`, then both
   dev agents resume from it.
5. **The server enforces; the client explains.** Any plan or diff that puts R1/R2 only
   in the client is wrong — reject it at the gate or in review.
6. **Migrations are one-way.** Gate the SQL at plan review; apply once; never edit an
   applied file.
7. If an agent needs the same correction twice, bake the correction into its
   `.claude/agents/<agent>.md` in this same PR — agent prompts ship via git like code.

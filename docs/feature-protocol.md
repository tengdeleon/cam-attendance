# CAM Feature Protocol — Reusable Agent Workflow

The **generalized** operating procedure for shipping any new mobile-app feature or change
in CAM, distilled from the two worked runbooks:
`docs/selfie-review-agent-workflow.md` (selfie view) and
`docs/attendance-validation-agent-workflow.md` (error handling / state validation).

This file is the source of truth. To run it for a specific feature, invoke the
`/cam-feature` slash command (`.claude/commands/cam-feature.md`), which reads this
protocol, generates a per-feature runbook `docs/<slug>-agent-workflow.md`, and drives the
flow. You can also follow this file by hand.

Last updated: 2026-07-08. Companion to `docs/agents.md` (agent-team design).

---

## 0. What this protocol is

A fixed six-stage pipeline — **plan → build → verify → review → document → ship** — run by
the CAM agent team over a **contract fixed on disk before any code is written**. It exists
to keep the orchestrator's context clean and the two tiers from drifting. The rules that
make it cheap and correct are in §9; read them once.

Execution surfaces (every command is tagged with one):

- **[MAIN SESSION]** — typed into the Claude Code chat: agent delegations, `/agents`,
  `SendMessage` follow-ups, `/cam-feature`.
- **[TERMINAL]** — a real shell at the repo root. Only git, the two dev servers, and
  reading plan/doc files. **You never run an agent's build commands** — dev agents
  self-verify via their own Bash tool.
- **[BROWSER]** — only when the feature needs it: Supabase dashboard (applying a SQL
  migration), GitHub (PR/merge).

Repo root for all **[TERMINAL]** steps:
`/Users/ethelbertdeleon/Eye Level/Claude/CAM-Center Attendance Monitoring`

---

## 1. The agent team (who does what)

Six project subagents live in `.claude/agents/`, driven from the **main session**
(the orchestrator). You never run an agent from a shell — you *delegate* by naming it
("use `cam-planner` to…") or by describing work that matches its `description`.

| Agent | Model | Writes? | Job |
|---|---|---|---|
| `cam-planner` | sonnet | plan file only | Turn the request into `docs/plans/<slug>.md`: the **contract**, exact file list, steps, risks, test checklist |
| `cam-backend-dev` | sonnet | `backend/` | Implement the backend section of the plan; runs scoped pytest before returning |
| `cam-mobile-dev` | sonnet | `app/src` | Implement the client section of the plan; runs `tsc --noEmit` before returning |
| `cam-qa` | haiku | nothing | Run pytest / tsc / gitleaks on the changed scope; report failures only + one verdict line |
| `cam-reviewer` | sonnet | nothing | Security/privacy/data-integrity review of the diff; findings only + one verdict line |
| `cam-user-manual-manager` | sonnet | `docs/user-manual.md`, `docs/feature-registry.md` | Update the teacher manual + developer feature registry for anything added/removed/updated |

Handoff artifacts — the **only** things passed between stages: plan file path, changed-file
list, qa verdict lines, reviewer findings, the manual/registry diff. Never paste code or
full logs between steps (that is what pollutes the orchestrator).

---

## 2. Decide the flow before you start (scope gate)

Not every change needs all six stages. Pick the flow from the change's blast radius:

| Change shape | Flow |
|---|---|
| One file, no contract change, no §9 surface | dev agent → `cam-qa` → `cam-user-manual-manager` (if user-visible) → commit. Skip planner + reviewer. |
| Multi-file **or** cross-tier **or** schema/migration **or** touches auth/capture/storage/exports (PROJECT_INSTRUCTIONS §9) | **Full pipeline** — every stage below. |

If in doubt, run the full pipeline. Below ~3 files and no §9 surface, the machinery costs
more than it saves (`docs/agents.md §4.5`).

**Always run `cam-user-manual-manager` when the change is user-visible or alters an
endpoint/behavior** — that is the point of adding it. A change the teacher can see or that
alters the API contract is never "done" until the manual and registry reflect it.

---

## 3. Pre-flight — branch + agent check

**[BROWSER]** If a previous feature's PR is still open, merge it first so this branch cuts
from a clean `main`.

**[TERMINAL]** One command at a time:

```bash
cd "/Users/ethelbertdeleon/Eye Level/Claude/CAM-Center Attendance Monitoring"
git config core.hooksPath .githooks     # fresh clones only; safe to re-run
git checkout main && git pull
git status                               # expect clean (untracked .claude/settings.local.json is ignorable)
ls .claude/agents                        # expect: cam-backend-dev cam-mobile-dev cam-planner cam-qa cam-reviewer cam-user-manual-manager
git checkout -b feat/<slug>              # work on a branch, never main
```

**[MAIN SESSION]** Verify Claude sees the whole team:

```
/agents
```

All six `cam-*` agents must list. If not, Claude Code isn't open at the repo root.

---

## 4. Stage 1 — Plan (cam-planner) + PLAN GATE

**[MAIN SESSION]** One delegation. Give it the goal and every constraint as hard
requirements; let the agent read the code and fix exact files. **Fix the contract first**
so the two tiers can build in parallel without drifting.

```
Use cam-planner: plan the "<feature name>" feature. Write the plan to
docs/plans/<slug>.md.

Goal: <one or two sentences — what the teacher can do afterward>.

Contract to fix first (so backend + mobile build in parallel):
<the API contract: method(s), path(s), request shape, response shape, and — if the
feature has error/business rules — the machine-readable error codes and any 2xx
warnings array. Client branches on codes, never on message text.>

Constraints:
- Respect PROJECT_INSTRUCTIONS §4–§9 (selfie required, server timestamp is the source of
  truth, Manila-local day boundaries never UTC, offline queue, RLS, retention).
- Server is the referee — business rules enforced in the backend, never client-only.
- <feature-specific constraints, e.g. private bucket / signed URLs, additive-only
  migration, offline-queue interaction>.

Flag <the single highest-risk interaction> as a named risk.
```

**What comes back:** the plan path + a ≤5-line summary only (by design — the body stays
on disk).

**[TERMINAL]** Read the plan yourself before spending dev tokens:

```bash
sed -n '1,250p' docs/plans/<slug>.md
```

**PLAN GATE — do not proceed unless the plan contains all of:**

1. An explicit **contract**: exact method/path/request/response, plus error codes and any
   warning shape if the feature has rules.
2. **Files to touch**, exact paths, one line of change each — on **both** tiers if
   cross-tier.
3. If a schema change: the migration file **sketched and additive-only** (never edits an
   applied migration).
4. A **Risks** section naming the highest-risk interaction (offline-queue behavior,
   Manila-day boundary, privacy surface — whichever applies).
5. A **Test checklist** naming what `cam-qa` will run.
6. A **Docs impact** line: which features are added/removed/updated, so
   `cam-user-manual-manager` knows its scope at Stage 5.

If any is missing or wrong, send it back to the **same** agent — never respawn:

```
Use cam-planner (SendMessage, same agent): the plan is missing <X>. Add it and update
docs/plans/<slug>.md in place.
```

---

## 5. Stage 1.5 — Migration (only if the plan ships schema) — you, manually

Dev agents cannot touch the Supabase project. If the plan includes a migration, it is a
**human [BROWSER] step**, applied **after** `cam-backend-dev` writes the file (Stage 2) and
**before** the smoke test (Stage 6):

- Supabase dashboard → project `cjdllpizedemzbrlfspv` → **SQL Editor** → paste the full
  contents of `backend/supabase/migrations/<nnnn_name>.sql` → **Run**.
- Verify the new tables/rows/views in Table Editor / Database → Views.
- **Never edit an applied migration file.** New change = new numbered file.

Skip this whole stage if the feature has no migration.

---

## 6. Stage 2 — Build both tiers in parallel

The contract is fixed, so the tiers can't drift. **[MAIN SESSION]** — issue both
delegations **in the same turn** so they run concurrently. (Single-tier feature? Issue only
the one that applies.)

```
Use cam-backend-dev: implement the backend section of docs/plans/<slug>.md
(<the endpoints/rules/migration, exactly per the plan's contract>). Smallest diff.
Run the scoped pytest before returning.
```

```
Use cam-mobile-dev: implement the client section of docs/plans/<slug>.md
(<the screens/handling/services, exactly per the plan's contract>). <Any privacy rule,
e.g. do not persist the selfie on device.> Run tsc --noEmit before returning.
```

**What comes back from each:** changed-file paths (one line each) + its own build-check
result line. No code dumps. Each dev agent runs its own verification internally
(`python -m pytest -q -k …` / `npx tsc --noEmit`). **You do not run those.**

> Sequencing rule: if mid-build one side needs a contract change, **stop**, amend
> `docs/plans/<slug>.md` via `cam-planner` (SendMessage), then resume **both** dev agents
> from the amended plan via SendMessage. Never let the sides drift (`docs/agents.md §5.7`).

If the plan had a migration, perform **Stage 1.5's [BROWSER] apply** now, before Stage 6.

---

## 7. Stage 3 — Verify (cam-qa)

**[MAIN SESSION]** Cheapest agent (haiku), full changed scope:

```
Use cam-qa: verify scope = <backend areas> + <app/src areas> + <migration file if any>.
Run backend pytest, the import smoke test (python -c "from app.main import app"),
app tsc --noEmit, and gitleaks at repo root. Also spot-check spec conformance:
selfie still required on POST /attendance, server_time still set server-side,
0001_init.sql untouched. Report failures only.
```

**Expected:** one line per check, ending `VERDICT: PASS`.

**On `VERDICT: FAIL`** — do **not** re-plan, do **not** respawn. Send only the failing
lines to the **same** dev agent (warm context):

```
Use cam-backend-dev (SendMessage, same agent): cam-qa failed —
<paste only the failing test names + ≤10-line excerpts>.
Fix with the smallest diff and re-run the scoped pytest.
```

Re-run `cam-qa` on the same scope. Loop until PASS.

---

## 8. Stage 4 — Review (cam-reviewer) — mandatory on the full pipeline

Required whenever the change touches auth, attendance capture, storage, migrations, or
exports (PROJECT_INSTRUCTIONS §9). **[MAIN SESSION]:**

```
Use cam-reviewer: review the diff for <feature> (git diff main...HEAD). Focus:
business rules enforced server-side and not bypassable by direct API calls;
Manila-day (not UTC) boundaries in every new query; responses leak no other person's
data; selfies stay private (signed URLs, short TTL, nothing persisted on device);
any migration additive and RLS not weakened; admin-only endpoints behind the admin
dependency; types in sync backend<->client. Findings only.
```

**Expected:** findings ordered BLOCKER / WARN / NIT, ending `REVIEW: APPROVE` or
`REVIEW: BLOCK (<n>)`.

**On BLOCK:** route each blocker to the tier that owns it via SendMessage
(backend → `cam-backend-dev`, client → `cam-mobile-dev`), re-run `cam-qa` on the touched
scope, then re-run `cam-reviewer`. **Treat every privacy or attendance-data-integrity
finding as blocking even if marked WARN** — that is CAM's §9 risk surface.

---

## 9. Stage 5 — Document (cam-user-manual-manager) — mandatory when user-visible

A feature is not done until the docs reflect it. Run this **after** review approves and
**before** commit, so the manual/registry changes land in the same PR as the code.

**[MAIN SESSION]:**

```
Use cam-user-manual-manager: this branch <added|updated|removed> <feature> — see the
"Docs impact" line in docs/plans/<slug>.md and git diff main...HEAD. Update
docs/user-manual.md (teacher how-to) and docs/feature-registry.md (developer registry)
to match exactly what shipped: new/changed screens, endpoints, and teacher-visible
behavior. For a removed feature, delete its sections and note the removal date. Keep the
registry's endpoint table in sync with backend/api/app/routers. Report the doc sections
touched only.
```

**Expected:** the two doc paths + a list of sections added/updated/removed. No prose dumps.

**Gate:** open `docs/user-manual.md` and `docs/feature-registry.md` and confirm the new
behavior is actually described and no stale text for a removed feature remains. If the
change is purely internal (no teacher-visible effect and no endpoint change), you may
record that in the registry only and skip the teacher manual — state that explicitly to
the agent.

---

## 10. Stage 6 — Smoke test, commit & ship

Automated checks don't prove the UX. **[TERMINAL]**, two shells from the repo root:

```bash
# shell 1 — backend
cd backend/api && source .venv/bin/activate && uvicorn app.main:app --reload --host 0.0.0.0
```

```bash
# shell 2 — client (API base URL must be the LAN/hotspot IP, not localhost —
# startDevCAM.command rewrites app/.env, or set it by hand)
cd app && npx expo start
```

Walk the feature's own acceptance path in Expo Go (use a test person, not real data);
the per-feature runbook lists the exact steps. Revert any test data afterward.

Commit only after **`VERDICT: PASS`** and **`REVIEW: APPROVE`** and the docs are updated
and a clean smoke test. **[TERMINAL]:**

```bash
cd "/Users/ethelbertdeleon/Eye Level/Claude/CAM-Center Attendance Monitoring"
git add -A
git status                       # eyeball the file list against the plan's "Files to touch" + the two doc files
git commit -m "feat(<area>): <feature> + docs"
git push -u origin feat/<slug>
```

The `.githooks/pre-commit` gitleaks hook (fail-closed) runs on commit; if it blocks, there
is a secret in the diff — **fix it, never bypass**. **[BROWSER]** Open the PR; the CI
backstop re-runs the secret scan; merge. Render auto-deploys `main` (free-tier cold start
~30 s; a migration must already be applied in Supabase before deployed code serves it).

---

## 11. The whole flow at a glance

```
[BROWSER]  merge prior PR (if open)
[TERMINAL] main → pull → branch feat/<slug> → /agents check (6 agents)
     │
[MAIN] cam-planner ──► docs/plans/<slug>.md   (FIX CONTRACT)  ── PLAN GATE ──
     │  (you read + gate the plan)
     ├──────────────────┬─────────────────────────  parallel, same contract
[MAIN] cam-backend-dev              [MAIN] cam-mobile-dev
     └──────────────────┴─────────────────────────
[BROWSER]  apply migration (only if the plan ships one)
     │
[MAIN] cam-qa ──► VERDICT: PASS / FAIL
     │   FAIL → SendMessage same dev agent (failing lines only) → re-qa
[MAIN] cam-reviewer ──► REVIEW: APPROVE / BLOCK   (privacy/integrity = blocking)
     │   BLOCK → SendMessage owning dev agent → re-qa → re-review
[MAIN] cam-user-manual-manager ──► user-manual.md + feature-registry.md updated
     │
[TERMINAL] manual smoke test
[TERMINAL] git commit (gitleaks hook) + push → PR → merge → Render deploy
```

---

## 12. Rules that keep this cheap and correct

1. **Fix the contract before parallelizing.** One source of truth
   (`docs/plans/<slug>.md`); any change goes through `cam-planner`, then both dev agents
   resume from it. Parallel agents on an unstable contract cost double in rework.
2. **The server enforces; the client explains.** Any plan or diff that puts a business
   rule only in the client is wrong — reject it at the gate or in review.
3. **Never run an agent's build commands yourself** — dev agents self-verify; you run only
   git, the two dev servers, and (if needed) the Supabase SQL Editor.
4. **Rework = `SendMessage` to the same agent**, never a fresh spawn — warm context; a
   respawn re-derives everything cold.
5. **Hand off through files** (plan path, qa verdict lines, reviewer findings, doc diff) —
   never paste code or full logs between steps.
6. **Privacy and attendance-data-integrity findings block the merge**, full stop — CAM's
   §9 involves minors' images.
7. **Migrations are one-way.** Gate the SQL at plan review; apply once; never edit an
   applied file.
8. **Docs ship with code.** `cam-user-manual-manager` runs in the same PR as the feature —
   a merged feature with stale docs is an incomplete feature.
9. If an agent needs the same correction twice, bake it into its `.claude/agents/<agent>.md`
   in the same PR — agent prompts ship via git like code.

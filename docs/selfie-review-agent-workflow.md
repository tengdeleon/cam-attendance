# Selfie Review Feature — Agent Workflow Runbook

Step-by-step guide to building the **selfie review** feature using the CAM agent team.
Feature: in History (and Today), a teacher taps an attendance row to view the selfie
captured at that check-in/out, to visually verify the log was valid.

Last updated: 2026-07-07. Companion to `docs/agents.md` (agent design) — this file is the
operational script for one specific feature.

---

## 0. What "the agents" are and where you drive them

Five project subagents live in `.claude/agents/` and are invoked from your **main Claude Code
session** (the orchestrator). You never run an agent from a shell — you *delegate* to it in the
Claude Code chat, either by naming it ("use `cam-planner` to…") or by describing work that
matches its `description` so Claude auto-routes.

| Agent | Model | Writes? | Job in this feature |
|---|---|---|---|
| `cam-planner` | sonnet | plan file only | Produce `docs/plans/selfie-review.md` — the API contract + file list both dev agents build to |
| `cam-backend-dev` | sonnet | `backend/` | Add the signed-URL selfie endpoint |
| `cam-mobile-dev` | sonnet | `app/src` | Add the tap-to-view selfie UI |
| `cam-qa` | haiku | nothing | Run pytest / tsc / gitleaks, report failures only |
| `cam-reviewer` | sonnet | nothing | Privacy + security review of the diff (this feature exposes minors' images — blocking scope) |

Two execution surfaces are used throughout, and every command below is tagged with one:

- **[MAIN SESSION]** — typed into the Claude Code chat (delegations, `/agents`, `SendMessage`).
- **[TERMINAL]** — typed into a real shell at the repo root. These are the only steps *you*
  type shell commands for (git, running the dev servers). The dev agents run their own build
  checks internally via their Bash tool; you don't run those yourself.

Repo root for all **[TERMINAL]** steps:
`/Users/ethelbertdeleon/Eye Level/Claude/CAM-Center Attendance Monitoring`

---

## 1. Why this feature needs the full flow

It touches **both tiers** and the **§9 privacy checklist** (selfies of minors, private bucket,
signed URLs, RA 10173). Per `docs/agents.md §2`, that means the full pipeline —
planner → dev(s) → qa → reviewer → commit — not a single-file shortcut. Backend and mobile can
run **in parallel** because the plan fixes the API contract first.

The technical shape (so you can sanity-check the plan the agent returns):

- **Backend:** the `selfies` bucket is private. The client can't load an image by path. So the
  backend needs a new endpoint that returns a **short-lived signed URL** for one attendance
  record's selfie, e.g. `GET /attendance/{id}/selfie` → `{ "url": "...", "expires_in": 60 }`.
  It reuses `services/storage_service.py` (signed-URL helper) and stays behind
  `current_teacher`. History rows must expose the attendance `id` so the client can request it.
- **Mobile:** `HistoryScreen.tsx` and `TodayScreen.tsx` get a tappable row → a modal/full-screen
  image. New `getSelfieUrl(id)` in `services/attendanceApi.ts`; a reusable `SelfieModal`
  component. The signed URL is fetched on demand and **not persisted** (privacy rule: no selfie
  cached on device beyond viewing).

---

## 2. Pre-flight — one time, in a terminal

**[TERMINAL]** Confirm the agent team is present and the tree is clean before you start:

```bash
cd "/Users/ethelbertdeleon/Eye Level/Claude/CAM-Center Attendance Monitoring"
git config core.hooksPath .githooks     # fresh clones only; safe to re-run
ls .claude/agents                        # expect: cam-backend-dev cam-mobile-dev cam-planner cam-qa cam-reviewer
git status                               # start from a clean or intentionally-staged tree
git checkout -b feat/selfie-review       # work on a branch, not main
```

**[MAIN SESSION]** Verify Claude can see all five agents:

```
/agents
```

You should see the five `cam-*` agents listed. If not, you're not at the repo root — reopen
Claude Code in the path above.

---

## 3. Step 1 — Plan (cam-planner)

**[MAIN SESSION]** Delegate the plan. Give it the goal and the contract constraint; let it read
the code and decide exact files:

```
Use cam-planner: plan the "selfie review" feature. Goal: a teacher taps an attendance
row in History and Today to view the selfie captured for that check-in/out, to verify the
log is valid. Constraints: selfies bucket stays private (signed URLs only, short TTL),
endpoint stays behind the teacher auth dependency, no selfie persisted on device beyond
viewing (RA 10173, §9). Fix the API contract first so backend and mobile can build in
parallel. Write the plan to docs/plans/selfie-review.md.
```

**What comes back:** only the plan path + a ≤5-line summary (by design — the plan body is on
disk, not dumped into chat).

**[TERMINAL]** Read the plan yourself before spending dev tokens on it:

```bash
sed -n '1,200p' docs/plans/selfie-review.md
```

Gate check before proceeding — the plan must contain:
- an explicit **API contract** (method, path, request, response JSON) for the selfie-URL endpoint;
- **Files to touch** with exact paths on both tiers;
- a **Test checklist** naming what `cam-qa` runs;
- a **Risks** section that mentions signed-URL TTL and on-device non-persistence.

If any is missing or wrong, don't hand it to the dev agents — send it back:

```
Use cam-planner (SendMessage, same agent): the contract is underspecified. Add the exact
response schema and the signed-URL TTL, and confirm HistoryRow exposes the attendance id.
Update docs/plans/selfie-review.md in place.
```

---

## 4. Step 2 — Build both tiers in parallel

Because the contract is now fixed, spawn both dev agents. **[MAIN SESSION]** — issue both
delegations in the same turn so they run concurrently:

```
Use cam-backend-dev: implement the backend section of docs/plans/selfie-review.md
(the GET /attendance/{id}/selfie signed-URL endpoint). Smallest diff. Run the scoped
pytest before returning.
```

```
Use cam-mobile-dev: implement the client section of docs/plans/selfie-review.md
(tap-to-view selfie in HistoryScreen and TodayScreen, getSelfieUrl in attendanceApi,
SelfieModal component). Do not persist the selfie on device. Run tsc --noEmit before returning.
```

**What comes back from each:** changed-file paths (one line each) + their own build-check result
line. No code dumps. Each dev agent runs its own verification internally —
`cam-backend-dev` runs `python -m pytest -q -k ...`, `cam-mobile-dev` runs `npx tsc --noEmit`.
You do **not** run those yourself.

> Sequencing note: keep both on the *same fixed contract*. If mid-build one side needs a
> contract change, stop, amend `docs/plans/selfie-review.md` via `cam-planner`, then continue
> both agents via `SendMessage` — never let the two sides drift, or you pay double in rework
> (`docs/agents.md §5.7`).

---

## 5. Step 3 — Verify (cam-qa)

**[MAIN SESSION]** Run the cheapest agent (haiku) across everything that changed:

```
Use cam-qa: verify scope = backend attendance router/service + app/src History and Today
screens and attendanceApi. Run backend pytest, the import smoke test, app tsc --noEmit,
and gitleaks at repo root. Report failures only.
```

**Expected output:** one line per check on PASS, ending in `VERDICT: PASS`.

**Rework loop on `VERDICT: FAIL`:** do **not** re-plan and do **not** respawn a fresh dev agent.
Send only the failing lines back to the *same* dev agent — its context is still warm:

```
Use cam-backend-dev (SendMessage, same agent): cam-qa failed —
<paste only the failing test name + the ≤10-line excerpt cam-qa returned>.
Fix with the smallest diff and re-run the scoped pytest.
```

Then re-run `cam-qa` on the same scope. Repeat until `VERDICT: PASS`.

---

## 6. Step 4 — Review (cam-reviewer) — mandatory here

This feature exposes minors' images, so review is **not optional** (it hits auth, storage, and
privacy in the reviewer's checklist). **[MAIN SESSION]:**

```
Use cam-reviewer: review the diff for the selfie-review feature (git diff main...HEAD).
Focus: endpoint behind teacher auth dependency; signed URL short-lived and bucket still
private (no public exposure); no selfie written to device storage beyond the in-memory
view; response leaks no other person's path; types in sync backend<->client. Findings only.
```

**Expected output:** findings ordered BLOCKER / WARN / NIT, ending in `REVIEW: APPROVE` or
`REVIEW: BLOCK (<n>)`.

**On `REVIEW: BLOCK`:** route each blocker back to the tier that owns it via `SendMessage`
(backend blockers → `cam-backend-dev`, client blockers → `cam-mobile-dev`), re-run `cam-qa` on
the touched scope, then re-run `cam-reviewer`. Treat every **privacy** finding as blocking even
if the reviewer marked it WARN.

---

## 7. Step 5 — Manual smoke test

Automated checks don't prove the image actually renders. Run the app once. **[TERMINAL]**, two
shells from the repo root:

```bash
# shell 1 — backend
cd backend/api && source .venv/bin/activate && uvicorn app.main:app --reload --host 0.0.0.0
```

```bash
# shell 2 — client  (API base URL must be the LAN/hotspot IP, not localhost — see app/src/constants/config)
cd app && npx expo start
```

Then in Expo Go: log in → open **History** → tap a row with a selfie → confirm the image loads,
the modal closes, and re-opening re-fetches (URL is short-lived). Repeat on **Today**.
Confirm a row with no selfie degrades gracefully.

---

## 8. Step 6 — Commit & push

Only after `VERDICT: PASS` **and** `REVIEW: APPROVE` **and** a clean manual smoke test.
**[TERMINAL]:**

```bash
cd "/Users/ethelbertdeleon/Eye Level/Claude/CAM-Center Attendance Monitoring"
git add -A
git status                       # eyeball the file list against the plan's "Files to touch"
git commit -m "feat(attendance): selfie review — signed-URL endpoint + tap-to-view in History/Today"
git push -u origin feat/selfie-review
```

The `.githooks/pre-commit` (gitleaks, fail-closed) runs automatically on commit; if it blocks,
you have a secret in the diff — fix it, don't bypass. Open the PR from `feat/selfie-review`;
the CI backstop re-runs the secret scan.

---

## 9. The whole flow at a glance

```
[TERMINAL]  branch + /agents check
     │
[MAIN] cam-planner ──► docs/plans/selfie-review.md   (fix API contract)
     │  (you read + gate the plan)
     ├───────────────┬──────────────────────────────  parallel, same contract
[MAIN] cam-backend-dev            [MAIN] cam-mobile-dev
   GET /attendance/{id}/selfie       tap-to-view + SelfieModal + getSelfieUrl
     └───────────────┴──────────────────────────────
     │
[MAIN] cam-qa ──► VERDICT: PASS / FAIL
     │   FAIL → SendMessage same dev agent (failing lines only) → re-qa
[MAIN] cam-reviewer ──► REVIEW: APPROVE / BLOCK   (privacy = blocking)
     │   BLOCK → SendMessage owning dev agent → re-qa → re-review
[TERMINAL]  manual smoke test (backend + expo)
[TERMINAL]  git commit (gitleaks hook) + push → PR
```

## 10. Rules that keep this cheap and correct

1. **Never** run an agent's build commands yourself — the dev agents self-verify; you only run
   git and the two dev servers.
2. **Rework = `SendMessage` to the same agent**, never a fresh spawn — the context is warm and a
   respawn re-derives everything cold.
3. **Hand off through files** (the plan path, the qa verdict lines, the reviewer findings) — never
   paste code or full logs between steps; that's what pollutes the orchestrator's context.
4. **Fix the contract before parallelizing.** One source of truth (`docs/plans/selfie-review.md`);
   any change to it goes through `cam-planner`, then both dev agents resume from it.
5. **Privacy findings block the merge**, full stop — this feature is exactly the §9 risk surface.
6. If an agent needs the same correction twice, put the correction into its
   `.claude/agents/<agent>.md` in this same PR — agent prompts ship via git like code.

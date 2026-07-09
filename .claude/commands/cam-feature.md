---
description: Detail and drive a new CAM mobile-app feature or change through the six-stage agent protocol (plan → build → verify → review → document → ship).
argument-hint: <feature name / one-line description of the change>
---

You are the **orchestrator** for a new CAM feature. The user wants to build, change, or
remove this feature or behavior:

**$ARGUMENTS**

Follow the reusable protocol in `docs/feature-protocol.md` exactly. Do not improvise a
different flow. The two worked examples to imitate are
`docs/selfie-review-agent-workflow.md` and `docs/attendance-validation-agent-workflow.md`.

## Step 0 — Read the protocol and check state (do this first)

1. Read `docs/feature-protocol.md` in full — it is the source of truth for every stage.
2. Read `docs/agents.md` §2 (interaction model) if you need the scope-gate rules.
3. Confirm the six agents exist: the files under `.claude/agents/` must include
   `cam-planner`, `cam-backend-dev`, `cam-mobile-dev`, `cam-qa`, `cam-reviewer`,
   `cam-user-manual-manager`. If any is missing, stop and tell the user.

## Step 1 — Interview the user (contract first, cheaply)

Before spending any agent tokens, pin down what the protocol's PLAN GATE (§4) needs. Ask
the user only what you cannot infer from the repo, in one batched round:

- **Goal:** what can a teacher do after this ships? (one or two sentences)
- **Scope gate (§2):** is this one-file/no-contract, or multi-file / cross-tier / schema /
  §9-surface (auth, capture, storage, exports)? Pick the flow accordingly.
- **Contract:** the endpoint(s) — method, path, request, response — and, if the feature
  has business rules, the machine-readable error codes + any 2xx `warnings` shape. The
  client must branch on codes, never on message text.
- **Highest risk:** the single riskiest interaction (offline-queue behavior, Manila-day
  boundary, minors'-image privacy — whichever applies).
- **Docs impact:** which features/screens/endpoints are added, updated, or removed (feeds
  Stage 5).

Derive a **kebab `<slug>`** from the feature name (e.g. "selfie review" → `selfie-review`).

## Step 2 — Generate the per-feature runbook

Write `docs/<slug>-agent-workflow.md` by instantiating `docs/feature-protocol.md` for this
feature — same structure and tone as the two existing `*-agent-workflow.md` files:
concrete contract, exact delegation prompts, exact PLAN GATE checklist, exact smoke-test
acceptance steps for this feature's rules, and the "at a glance" diagram. This file is the
operational script; the protocol is the template. Show the user the runbook path and a
≤5-line summary, and pause for their go-ahead before spending dev tokens.

## Step 3 — Drive the stages

Execute the protocol stage by stage, delegating to the agents exactly as
`docs/feature-protocol.md` prescribes. Respect every rule in §12:

- **[TERMINAL]** and **[BROWSER]** steps are the **user's** to run — surface them as
  explicit, copy-pasteable blocks and wait; never run an agent's build commands yourself.
- Fix the contract in `docs/plans/<slug>.md` before parallelizing the two dev agents.
- Rework = `SendMessage` to the **same** agent with only the failing lines — never respawn.
- Hand off through files; never paste code or full logs between stages.
- **Stage 5 is mandatory when the change is user-visible or alters an endpoint:** run
  `cam-user-manual-manager` to update `docs/user-manual.md` and `docs/feature-registry.md`
  in the same PR. A merged feature with stale docs is incomplete.
- Do not tell the user to commit until `VERDICT: PASS`, `REVIEW: APPROVE`, docs updated,
  and a clean smoke test.

## Guardrails

- If the scope gate says one-file / no §9 surface, use the short flow (dev → qa → manual if
  user-visible → commit) and say so — don't run the full pipeline for a trivial change.
- If the user's contract puts a business rule client-only, push back: the server is the
  referee (§12 rule 2).
- If a migration is involved, remember it is a human [BROWSER] step in Supabase, applied
  once, never editing an applied file.

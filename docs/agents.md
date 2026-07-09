# CAM Agent Team — Design, Interaction, Build & Deploy

Six Claude Code subagents for the CAM repo, optimized for token cost and accuracy.
Definitions live in `.claude/agents/*.md` (already created). Last updated: 2026-07-08.

The reusable operating procedure that sequences these agents for any new feature is
`docs/feature-protocol.md`, invoked via the `/cam-feature` slash command
(`.claude/commands/cam-feature.md`).

## 1. The agents

| Agent | Model | Tools | Role | When to invoke |
|---|---|---|---|---|
| `cam-planner` | sonnet | Read, Grep, Glob, Write | Turns a feature request into a plan file (`docs/plans/<slug>.md`): exact files, ordered steps, risks, test checklist | Before any multi-file feature, refactor, or schema change. Skip for one-file fixes |
| `cam-backend-dev` | sonnet | Read, Edit, Write, Grep, Glob, Bash | Implements FastAPI/Supabase work under `backend/` per plan; runs scoped pytest before returning | Any backend task, after a plan exists (or directly for small scoped tasks) |
| `cam-mobile-dev` | sonnet | Read, Edit, Write, Grep, Glob, Bash | Implements Expo/RN work under `app/src` per plan; runs `tsc --noEmit` before returning | Any client task, same rule as backend |
| `cam-qa` | **haiku** | Bash, Read, Grep, Glob (read-only) | Runs pytest / tsc / eslint / gitleaks; reports failures only + one verdict line | After every dev-agent run, before commit. Cheapest agent — use liberally |
| `cam-reviewer` | sonnet | Read, Grep, Glob, Bash (read-only) | Diff-scoped security/privacy/code review: auth deps, secrets, RLS, selfie retention, RA 10173, type sync | Before merging anything touching auth, capture, storage, migrations, exports; monthly audit |
| `cam-user-manual-manager` | sonnet | Read, Edit, Write, Grep, Glob, Bash | Keeps `docs/user-manual.md` (teacher how-to) and `docs/feature-registry.md` (developer registry) in sync with what shipped; writes only those two docs | After review, before commit, whenever a feature is added/updated/removed and is user-visible or changes an endpoint |

Why these six: they map to the feature lifecycle (design → develop ×2 tiers → test → review → **document** → ship). Each has a hard scope boundary (no overlap = no duplicated context); qa and reviewer are read-only so they can never corrupt work; the doc manager writes only the two documentation files. The manual manager exists so a merged feature never ships with stale docs — documentation is part of "done", not an afterthought.

## 2. Interaction model

Hub-and-spoke. **You (the main Claude session) are the orchestrator.** Agents never call each other; they hand off through files, and the orchestrator sequences them. File-based handoff is the core token optimization: the plan is written once to disk and each downstream agent reads only that file, instead of the orchestrator re-pasting context into every prompt.

```
                        you / main session (orchestrator)
                          │  1. task
                          ▼
                     cam-planner ──writes──► docs/plans/<slug>.md
                          │  2. plan path returned (≤5 lines)
          ┌───────────────┴───────────────┐
          ▼ 3a. "implement plan X,        ▼ 3b. (parallel if plan
             backend section"                touches both tiers)
    cam-backend-dev                  cam-mobile-dev
          │ edits backend/                 │ edits app/src
          └───────────────┬───────────────┘
                          ▼  4. "verify scope: <changed areas>"
                       cam-qa ──► VERDICT: PASS / FAIL
                          │  FAIL → back to the dev agent (SendMessage,
                          │         same agent, context intact)
                          ▼  5. "review diff <range>"
                     cam-reviewer ──► APPROVE / BLOCK
                          │  BLOCK → back to dev agent with findings
                          ▼  6. "update docs for <feature>"
              cam-user-manual-manager ──► user-manual.md + feature-registry.md
                          │
                          ▼
                   you commit + push
```

Standard flows:

- **Feature (multi-file):** planner → dev(s) → qa → reviewer → **doc manager** → commit. Backend and mobile dev can run in parallel when the plan splits cleanly at the API contract (planner defines the contract first, both sides build to it). Full procedure: `docs/feature-protocol.md`.
- **Bugfix (single file):** dev agent directly (skip planner) → qa → doc manager if user-visible. Reviewer only if the fix touches the §7 checklist areas.
- **Rework loop:** on qa FAIL or reviewer BLOCK, continue the *same* dev agent via SendMessage with only the failure lines — its context is intact, so it costs a fraction of a fresh spawn.
- **Maintenance (monthly):** cam-qa full run + cam-reviewer audit of `git diff <last-audit-tag>..HEAD`; findings become planner tasks.

Handoff artifacts (the only things passed between steps): plan file path, changed-file list, qa verdict lines, reviewer findings table, the doc-manager's sections-touched list. Never full file contents or logs.

## 3. Build steps

Already done in this repo — kept here for rebuilding or porting to another machine/project.

1. Create `.claude/agents/` at the repo root (project-level agents; commit them so every clone gets the team).
2. One markdown file per agent with YAML frontmatter:

   ```markdown
   ---
   name: cam-qa
   description: <when to use — Claude reads this to auto-delegate; include "use AFTER..." triggers>
   tools: Bash, Read, Grep, Glob        # whitelist — omit to inherit all (don't)
   model: haiku                          # haiku | sonnet | opus | inherit
   ---
   <system prompt: role, repo facts, hard rules, output format>
   ```

3. Prompt-writing rules that drive cost and accuracy:
   - **State repo facts** the agent would otherwise burn tokens rediscovering (folder map, JWT scheme, SDK pin, hotspot-IP gotcha).
   - **Restrict tools** to the minimum. Read-only agents (qa, reviewer) get no Edit/Write.
   - **Prescribe the output format** and forbid dumps ("paths only", "≤10 lines per failure", "no diffs"). The agent's final message lands in the orchestrator's context — this is where token bloat happens.
   - **Bound the reading** ("review only the diff", "read one neighboring module").
4. Verify: run `/agents` in Claude Code — all five should list; or ask "use cam-qa to verify the backend" and confirm delegation.
5. Commit `.claude/agents/` and `docs/agents.md`.

## 4. Deploy / rollout

1. **Smoke-test each agent once** with a trivial task (planner: plan a fake endpoint; qa: full run on clean tree; reviewer: review last commit). Fix prompts where output format isn't followed.
2. **Pilot on one real feature** (next milestone item) using the full flow in §2. Compare against doing it inline: the win should be less context pollution in your main session and a reusable plan file.
3. **Tune after pilot:** if an agent keeps needing the same correction, move that correction into its definition file — that's the deployment loop. Agent files are versioned, so improvements ship via git like code.
4. **Fresh clones:** nothing extra — agents ride along in the repo. (Remember the existing hook step: `git config core.hooksPath .githooks`.)
5. **When NOT to deploy an agent:** single-file edits, questions, quick reads. A spawn starts cold and re-derives context; below ~3 files touched, inline work in the main session is cheaper and faster.

## 5. Token-efficiency rules (summary)

1. Model tiering: haiku for mechanical verification, sonnet for everything else; no opus by default.
2. File-based handoffs: plans and findings live on disk, not in chat context.
3. Scoped inputs: every agent gets a scope ("backend only", "this diff"), never "look at the project".
4. Terse outputs: enforced in every agent prompt — verdict lines, path lists, capped excerpts.
5. Reuse via SendMessage for rework instead of respawning.
6. Skip the machinery for small tasks (§4.5).
7. Parallelize backend/mobile only when the API contract is fixed first — parallel agents on an unstable contract cost double in rework.

## 6. Risks / trade-offs

- Agents are only as current as their definition files — when architecture changes (e.g., new auth scheme), update the affected agent prompt in the same PR.
- Hub-and-spoke means the orchestrator session still carries the workflow; for very long features, restart the main session between planner and dev phases (the plan file preserves state).
- haiku on qa: adequate for running commands and excerpting failures; if it misdiagnoses, upgrade cam-qa to sonnet — cost is still low because its output is capped.

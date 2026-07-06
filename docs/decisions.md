# Architecture Decision Log

## ADR-001 — Expo (React Native) for the client
Free, open source, single codebase for Android+iOS, instant on-device testing via Expo Go. Matches a fast-MVP, low-budget single center.

## ADR-002 — Supabase free tier for backend
Postgres + Auth + Storage + RLS in one free project. SQL fits the team's DB background; RLS cleanly enforces teacher-only access. Firebase is the documented fallback; data access is isolated in `src/services` to keep swapping contained.

## ADR-003 — Selfie for verification, not recognition
Selfie is captured for human verification + an audit trail, NOT auto-identification. Avoids facial-recognition complexity, cost, and heightened legal exposure.

## ADR-004 — Offline-first capture
Entrance may have weak Wi-Fi. Entries + images queue locally (expo-sqlite) and sync when online. Server timestamp is source of truth; device timestamp stored to detect drift.

## ADR-005 — Dedicated FastAPI backend tier (full-stack)
Added a real server tier (FastAPI/Python) between the app and Supabase instead of
client-direct-to-BaaS. The API owns business logic, validation, selfie-upload
orchestration, CSV export, and retention. Benefits: secrets (service-role key) stay
server-side; business rules are centralized and testable; the data layer is swappable;
stronger full-stack artifact. Cost: one more deployable (free on Render/Fly) and a
second language (Python alongside the TS client). RLS is kept as defense-in-depth.

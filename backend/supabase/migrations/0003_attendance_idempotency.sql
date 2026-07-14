-- 0003_attendance_idempotency.sql
-- Make POST /attendance safe against duplicate submissions.
--
-- Two failure modes this closes:
--   1. Double-tap on the capture/confirm button -> two rows + two selfie uploads.
--   2. Offline-queue replay double-fire -> the same queued entry POSTed twice
--      (network flap mid-request, or app relaunch replaying a half-acked entry).
--
-- The client sends a stable idempotency_key per capture (its offline-queue id).
-- The API short-circuits on a known key; this partial unique index is the
-- defense-in-depth backstop for the concurrent-request race.

-- 1. Nullable key column. Nullable so pre-existing rows and any request that
--    omits the key remain valid (behaviour unchanged when no key is sent).
alter table attendance
  add column if not exists idempotency_key text;

-- 2. Partial unique index: uniqueness enforced ONLY for non-null keys, so legacy
--    rows (idempotency_key is null) never collide with each other.
create unique index if not exists uq_attendance_idempotency_key
  on attendance(idempotency_key)
  where idempotency_key is not null;

-- ---------------------------------------------------------------------------
-- Rollback note (manual — Supabase migrations are not transactional DDL on all
-- engines). If a partial apply occurs, reverse in this order:
--
--   drop index if exists uq_attendance_idempotency_key;
--   alter table attendance drop column if exists idempotency_key;
-- ---------------------------------------------------------------------------

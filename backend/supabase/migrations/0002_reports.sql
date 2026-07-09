-- CAM: attendance-validation feature support (additive only)
-- Adds: center_settings singleton, daily first-in / last-direction views,
-- and a composite index to support R1-R4 validation + Track A reports.
-- Run in Supabase SQL editor or via `supabase db push`.
-- Depends on: 0001_init.sql (is_teacher(), is_admin(), attendance table).

-- 1. center_settings singleton (from phase-11-plan.md A.2 spec)
create table if not exists center_settings (
  id            int primary key default 1 check (id = 1),
  open_time     time not null default '08:00',
  grace_minutes int  not null default 10,
  tz            text not null default 'Asia/Manila'
);
insert into center_settings (id) values (1) on conflict do nothing;

-- 2. RLS on center_settings
alter table center_settings enable row level security;
-- any authenticated teacher can read
create policy cs_select on center_settings for select using (is_teacher());
-- only admins may update
create policy cs_update on center_settings for update using (is_admin());

-- 3. Helper view for daily first-in (from phase-11-plan.md A.3 spec)
--    security_invoker = true: the view runs with the querying role's privileges,
--    so RLS on the attendance table is enforced for every caller (anon cannot bypass).
create or replace view v_daily_first_in
  with (security_invoker = true) as
select person_id,
       (server_time at time zone 'Asia/Manila')::date as local_day,
       min(server_time at time zone 'Asia/Manila')    as first_in_local
from attendance
where direction = 'in'
group by person_id, local_day;

-- 4. Helper view for daily last direction (needed for missed_checkout count)
--    security_invoker = true for the same reason — anon must not read attendance via view.
create or replace view v_daily_last_direction
  with (security_invoker = true) as
select person_id,
       (server_time at time zone 'Asia/Manila')::date as local_day,
       (array_agg(direction order by server_time desc))[1] as last_direction
from attendance
group by person_id, local_day;

-- 5. Index to support the today-bound queries added by R1/R2
--    idx_attendance_server_time already exists from 0001_init.sql.
--    Add a composite covering (person_id, server_time) for the validation queries.
create index if not exists idx_attendance_person_time
  on attendance(person_id, server_time);

-- ---------------------------------------------------------------------------
-- Rollback note (manual — Supabase migrations are not transactional DDL on all
-- engines). If a partial apply occurs, reverse in this order:
--
--   drop index if exists idx_attendance_person_time;
--   drop view if exists v_daily_last_direction;
--   drop view if exists v_daily_first_in;
--   drop policy if exists cs_update on center_settings;
--   drop policy if exists cs_select on center_settings;
--   drop table if exists center_settings;
-- ---------------------------------------------------------------------------

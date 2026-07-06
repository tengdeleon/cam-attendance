-- =====================================================================
-- Eye Level Dasmariñas — Dashboard
-- Migration V1: initial schema, constraints, triggers, views, RLS
-- Target: Supabase Postgres (15+). Safe to run on a fresh project.
--
-- Role model:
--   owner   -> sees everything, incl. monthly_enrollments (enrollment info)
--   teacher -> same as owner EXCEPT no access to monthly_enrollments
--   student -> NOT an auth account; clocks in via device-bound token
--
-- Identity in RLS comes from Supabase JWT:
--   auth.uid()                       -> profiles.id
--   helper app_role() / is_owner()   -> read role from profiles
-- The Spring Boot API also enforces these rules; RLS is defense-in-depth.
-- =====================================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid(), digest()

-- =====================================================================
-- People
-- =====================================================================
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  role        text not null check (role in ('owner','teacher')),
  phone       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- =====================================================================
-- Helper functions (role lookups for RLS)
-- Defined AFTER profiles: LANGUAGE sql bodies are validated at creation
-- time, so the referenced table must already exist.
-- =====================================================================
create or replace function public.app_role()
returns text
language sql stable
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_owner()
returns boolean
language sql stable
as $$
  select coalesce(public.app_role() = 'owner', false)
$$;

create or replace function public.is_staff()      -- teacher OR owner
returns boolean
language sql stable
as $$
  select public.app_role() in ('teacher','owner')
$$;

create table public.students (
  id               uuid primary key default gen_random_uuid(),
  full_name        text not null,
  birthdate        date,
  guardian_name    text,
  guardian_contact text,
  status           text not null default 'active'
                   check (status in ('active','paused','withdrawn')),
  created_at       timestamptz not null default now()
);

create table public.programs (
  id     uuid primary key default gen_random_uuid(),
  name   text not null unique,           -- 'Math', 'English'
  active boolean not null default true
);

-- =====================================================================
-- Student device-bound tokens (clock-in on personal phone, no account)
-- Store only the hash; the raw token lives in the student's saved link/QR.
-- =====================================================================
create table public.student_access_tokens (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.students(id) on delete cascade,
  token_hash   text not null unique,     -- encode(digest(raw,'sha256'),'hex')
  revoked      boolean not null default false,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
create index idx_token_active on public.student_access_tokens (token_hash) where revoked = false;

-- =====================================================================
-- Monthly enrollment (OWNER-ONLY)  — one row per student/program/month
-- =====================================================================
create table public.monthly_enrollments (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null references public.students(id) on delete cascade,
  program_id     uuid not null references public.programs(id),
  period_month   date not null,          -- first day of month, e.g. 2026-06-01
  level          text,
  status         text not null default 'enrolled'
                 check (status in ('enrolled','paused','withdrawn')),
  tuition_status text default 'unpaid'
                 check (tuition_status in ('paid','unpaid','partial')),
  notes          text,
  created_at     timestamptz not null default now(),
  unique (student_id, program_id, period_month),
  -- guard: period_month must be the first of a month
  constraint period_is_month_start check (date_trunc('month', period_month) = period_month)
);
create index idx_enroll_period on public.monthly_enrollments (period_month, status);

-- =====================================================================
-- Clock in/out — teachers AND students in one table
-- Exactly one of (teacher_id, student_id) is set.
-- =====================================================================
create table public.time_entries (
  id              uuid primary key default gen_random_uuid(),
  teacher_id      uuid references public.profiles(id),
  student_id      uuid references public.students(id) on delete cascade,
  clock_in_at     timestamptz not null default now(),  -- SERVER time
  clock_out_at    timestamptz,
  in_selfie_path  text not null,
  out_selfie_path text,
  in_lat numeric, in_lng numeric,                      -- optional, off by default
  out_lat numeric, out_lng numeric,
  source_ip       inet,
  status          text not null default 'open'
                  check (status in ('open','closed','edited')),
  created_at      timestamptz not null default now(),
  constraint one_subject check ( (teacher_id is not null) <> (student_id is not null) ),
  constraint out_after_in check ( clock_out_at is null or clock_out_at > clock_in_at )
);

-- One OPEN entry per person (prevents double clock-in)
create unique index uq_open_teacher on public.time_entries (teacher_id)
  where status = 'open' and teacher_id is not null;
create unique index uq_open_student on public.time_entries (student_id)
  where status = 'open' and student_id is not null;

create index idx_te_teacher_month on public.time_entries (teacher_id, clock_in_at);
create index idx_te_student_month on public.time_entries (student_id, clock_in_at);

-- =====================================================================
-- Immutable audit trail for edits to time_entries
-- =====================================================================
create table public.time_entry_audit (
  id            uuid primary key default gen_random_uuid(),
  time_entry_id uuid not null references public.time_entries(id) on delete cascade,
  edited_by     uuid not null references public.profiles(id),
  old_values    jsonb not null,
  new_values    jsonb not null,
  reason        text,
  edited_at     timestamptz not null default now()
);

-- Trigger: any UPDATE to a non-open entry writes an audit row + flags 'edited'.
create or replace function public.fn_audit_time_entry()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and row(new.*) is distinct from row(old.*) then
    insert into public.time_entry_audit(time_entry_id, edited_by, old_values, new_values)
    values (old.id, auth.uid(), to_jsonb(old), to_jsonb(new));
    if old.status <> 'open' then
      new.status := 'edited';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_audit_time_entry
  before update on public.time_entries
  for each row execute function public.fn_audit_time_entry();

-- =====================================================================
-- Reporting views
-- =====================================================================
-- Monthly student attendance: distinct days present per month.
create or replace view public.v_monthly_student_attendance as
  select student_id,
         date_trunc('month', clock_in_at)::date as period_month,
         count(distinct (clock_in_at at time zone 'Asia/Manila')::date) as days_present
  from public.time_entries
  where student_id is not null and status <> 'open'
  group by 1, 2;

-- Monthly teacher hours.
create or replace view public.v_monthly_teacher_hours as
  select teacher_id,
         date_trunc('month', clock_in_at)::date as period_month,
         sum(clock_out_at - clock_in_at) as total_hours
  from public.time_entries
  where teacher_id is not null and clock_out_at is not null
  group by 1, 2;

-- Monthly enrollment counts per program (owner view feeds off this).
create or replace view public.v_monthly_enrollment_counts as
  select program_id, period_month,
         count(*) filter (where status = 'enrolled') as enrolled_count,
         count(*) filter (where status = 'paused')   as paused_count,
         count(*) filter (where status = 'withdrawn') as withdrawn_count
  from public.monthly_enrollments
  group by 1, 2;

-- =====================================================================
-- Row-Level Security
-- =====================================================================
alter table public.profiles              enable row level security;
alter table public.students              enable row level security;
alter table public.programs              enable row level security;
alter table public.student_access_tokens enable row level security;
alter table public.monthly_enrollments   enable row level security;
alter table public.time_entries          enable row level security;
alter table public.time_entry_audit      enable row level security;

-- profiles: a user sees their own profile; owner sees all; owner manages.
create policy profiles_self_read  on public.profiles for select using (id = auth.uid() or public.is_owner());
create policy profiles_owner_write on public.profiles for all      using (public.is_owner()) with check (public.is_owner());

-- students: any staff (teacher or owner) full access.
create policy students_staff_all on public.students for all using (public.is_staff()) with check (public.is_staff());

-- programs: staff read; owner writes.
create policy programs_staff_read on public.programs for select using (public.is_staff());
create policy programs_owner_write on public.programs for all using (public.is_owner()) with check (public.is_owner());

-- student_access_tokens: staff manage (issue/revoke). Raw token never stored.
create policy tokens_staff_all on public.student_access_tokens for all using (public.is_staff()) with check (public.is_staff());

-- monthly_enrollments: OWNER ONLY. This is the single gated area.
create policy enroll_owner_all on public.monthly_enrollments for all using (public.is_owner()) with check (public.is_owner());

-- time_entries: any staff full access (review/correct). Student clock-in is
-- performed by the API via the service role using the token, not via RLS.
create policy time_staff_all on public.time_entries for all using (public.is_staff()) with check (public.is_staff());

-- time_entry_audit: staff read-only (trigger/service writes).
create policy audit_staff_read on public.time_entry_audit for select using (public.is_staff());

-- =====================================================================
-- Seed
-- =====================================================================
insert into public.programs (name) values ('Math'), ('English')
  on conflict (name) do nothing;

-- =====================================================================
-- NOTES
-- 1) Student clock-in/out runs through the Spring Boot API using the
--    Supabase SERVICE ROLE key (bypasses RLS) AFTER the API validates the
--    device token and resolves student_id server-side. Never expose the
--    service role key to the client.
-- 2) Selfie purge (60–90 days): scheduled job deletes Storage objects +
--    nulls in/out_selfie_path. Attendance rows are kept.
-- 3) period_month is always the 1st of the month (enforced by CHECK).
-- =====================================================================

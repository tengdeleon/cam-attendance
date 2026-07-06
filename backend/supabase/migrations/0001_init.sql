-- CAM initial schema (Supabase / Postgres)
-- Run in Supabase SQL editor or via `supabase db push`.

create extension if not exists "pgcrypto";

-- people: teachers and students
create table if not exists people (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  role        text not null check (role in ('teacher','student')),
  photo_url   text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- teacher_accounts: links auth users to a person and grants access
create table if not exists teacher_accounts (
  id            uuid primary key default gen_random_uuid(),
  person_id     uuid not null references people(id) on delete cascade,
  auth_user_id  uuid not null unique,
  is_admin      boolean not null default false,
  created_at    timestamptz not null default now()
);

-- attendance: one row per check-in/out event
create table if not exists attendance (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid not null references people(id) on delete cascade,
  direction    text not null check (direction in ('in','out')),
  selfie_url   text not null,
  logged_by    uuid not null references teacher_accounts(id),
  device_time  timestamptz,
  server_time  timestamptz not null default now(),
  sync_status  text not null default 'synced' check (sync_status in ('synced','pending'))
);

create index if not exists idx_attendance_person on attendance(person_id);
create index if not exists idx_attendance_server_time on attendance(server_time);

-- Row-Level Security
alter table people enable row level security;
alter table teacher_accounts enable row level security;
alter table attendance enable row level security;

-- helper: is the current auth user a teacher?
create or replace function is_teacher() returns boolean
language sql stable as $$
  select exists (select 1 from teacher_accounts ta where ta.auth_user_id = auth.uid());
$$;

create or replace function is_admin() returns boolean
language sql stable as $$
  select exists (select 1 from teacher_accounts ta where ta.auth_user_id = auth.uid() and ta.is_admin);
$$;

-- people policies
create policy people_select on people for select using (is_teacher());
create policy people_insert on people for insert with check (is_admin());
create policy people_update on people for update using (is_admin());

-- attendance policies
create policy attendance_select on attendance for select using (is_teacher());
create policy attendance_insert on attendance for insert with check (is_teacher());

-- teacher_accounts: a user can read their own row
create policy ta_select_self on teacher_accounts for select using (auth_user_id = auth.uid());

-- Storage bucket for selfies must be created in the dashboard (private),
-- with a policy allowing authenticated teachers to upload/read via signed URLs.

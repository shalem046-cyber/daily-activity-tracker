-- GWEEN profile, usage tracking, and privacy rules.
-- Run this entire file once in the Supabase SQL Editor.
-- Never put a service-role key into the website.

create extension if not exists pgcrypto;

create table if not exists public.gween_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text not null,
  avatar_color text not null default '#225c47',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gween_username_format check (username ~ '^[a-z0-9_]{3,20}$'),
  constraint gween_display_name_length check (char_length(display_name) between 2 and 40),
  constraint gween_avatar_color_allowed check (
    avatar_color in ('#225c47', '#497da1', '#8567a8', '#ba8050', '#bd6873', '#4d8b82')
  )
);

create table if not exists public.gween_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.gween_usage_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  active_seconds integer not null default 0 check (active_seconds >= 0),
  is_active boolean not null default true
);

create index if not exists gween_usage_user_idx
  on public.gween_usage_sessions(user_id);
create index if not exists gween_usage_last_seen_idx
  on public.gween_usage_sessions(last_seen_at desc);

alter table public.gween_profiles enable row level security;
alter table public.gween_admins enable row level security;
alter table public.gween_usage_sessions enable row level security;

-- Admin membership is never directly readable or writable by website users.
revoke all on public.gween_admins from anon, authenticated;
grant select, update on public.gween_profiles to authenticated;
grant select, insert, update on public.gween_usage_sessions to authenticated;

create or replace function public.is_gween_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.gween_admins
    where user_id = auth.uid()
  );
$$;

revoke all on function public.is_gween_admin() from public;
grant execute on function public.is_gween_admin() to authenticated;

drop policy if exists "Profile owner or admin can read profiles" on public.gween_profiles;
create policy "Profile owner or admin can read profiles"
  on public.gween_profiles
  for select
  to authenticated
  using (auth.uid() = user_id or public.is_gween_admin());

drop policy if exists "Profile owners can edit their profile" on public.gween_profiles;
create policy "Profile owners can edit their profile"
  on public.gween_profiles
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users read own usage or admins read all" on public.gween_usage_sessions;
create policy "Users read own usage or admins read all"
  on public.gween_usage_sessions
  for select
  to authenticated
  using (auth.uid() = user_id or public.is_gween_admin());

drop policy if exists "Users create own usage sessions" on public.gween_usage_sessions;
create policy "Users create own usage sessions"
  on public.gween_usage_sessions
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users update own usage sessions" on public.gween_usage_sessions;
create policy "Users update own usage sessions"
  on public.gween_usage_sessions
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Automatically create the public profile from the signup form's validated metadata.
create or replace function public.create_gween_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  requested_username text;
  requested_display_name text;
  requested_color text;
begin
  requested_username := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  requested_display_name := trim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  requested_color := coalesce(new.raw_user_meta_data ->> 'avatar_color', '#225c47');

  if requested_username !~ '^[a-z0-9_]{3,20}$' then
    requested_username := 'member_' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;

  if char_length(requested_display_name) < 2 or char_length(requested_display_name) > 40 then
    requested_display_name := coalesce(nullif(split_part(coalesce(new.email, 'GWEEN Member'), '@', 1), ''), 'GWEEN Member');
    requested_display_name := left(requested_display_name, 40);
    if char_length(requested_display_name) < 2 then
      requested_display_name := 'GWEEN Member';
    end if;
  end if;

  if requested_color not in ('#225c47', '#497da1', '#8567a8', '#ba8050', '#bd6873', '#4d8b82') then
    requested_color := '#225c47';
  end if;

  insert into public.gween_profiles(user_id, username, display_name, avatar_color)
  values (new.id, requested_username, requested_display_name, requested_color);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_gween_profile on auth.users;
create trigger on_auth_user_created_gween_profile
  after insert on auth.users
  for each row execute procedure public.create_gween_profile_for_new_user();

-- Bootstrap your owner/admin account after you sign up:
-- insert into public.gween_admins(user_id)
-- select id from auth.users where lower(email) = lower('YOUR-EMAIL-HERE')
-- on conflict (user_id) do nothing;

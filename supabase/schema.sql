-- THE GRIND initial schema. Run in Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now()
);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_date date not null default current_date,
  category text not null,
  title text not null,
  detail text,
  duration_minutes integer not null check (duration_minutes > 0),
  source text not null default 'manual' check (source in ('manual','focus_timer')),
  created_at timestamptz not null default now()
);

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  target numeric not null check (target > 0),
  unit text not null,
  weight numeric not null default 0 check (weight >= 0 and weight <= 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.goal_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  progress_date date not null default current_date,
  amount numeric not null default 0 check (amount >= 0),
  unique (goal_id, progress_date)
);

create table if not exists public.schedule_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  category text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','completed','missed','postponed')),
  recurrence jsonb,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null default current_date,
  content text not null default '',
  updated_at timestamptz not null default now(),
  unique (user_id, entry_date)
);

alter table public.profiles enable row level security;
alter table public.activities enable row level security;
alter table public.goals enable row level security;
alter table public.goal_progress enable row level security;
alter table public.schedule_items enable row level security;
alter table public.journal_entries enable row level security;

create policy "profile owner access" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "activities owner access" on public.activities for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "goals owner access" on public.goals for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "goal progress owner access" on public.goal_progress for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "schedule owner access" on public.schedule_items for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "journal owner access" on public.journal_entries for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Create a profile row automatically when a user signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

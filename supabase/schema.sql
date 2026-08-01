create extension if not exists pgcrypto;

create table if not exists public.profiles (
  code text primary key check (code in ('daeho', 'sanghee')),
  display_name text not null,
  event_color text not null,
  day_off_color text not null,
  created_at timestamptz not null default now()
);

insert into public.profiles (code, display_name, event_color, day_off_color)
values
  ('daeho', '대호', '#7FA99B', '#E1EEEA'),
  ('sanghee', '상희', '#E9A6AD', '#FAE4E6')
on conflict (code) do update set
  display_name = excluded.display_name,
  event_color = excluded.event_color,
  day_off_color = excluded.day_off_color;

create table if not exists public.calendar_color_settings (
  id text primary key default 'calendar' check (id = 'calendar'),
  daeho_color text not null default '#7FA99B'
    check (daeho_color ~ '^#[0-9A-Fa-f]{6}$'),
  sanghee_color text not null default '#E9A6AD'
    check (sanghee_color ~ '^#[0-9A-Fa-f]{6}$'),
  shared_color text not null default '#FFD43B'
    check (shared_color ~ '^#[0-9A-Fa-f]{6}$'),
  private_color text not null default '#845EF7'
    check (private_color ~ '^#[0-9A-Fa-f]{6}$'),
  updated_at timestamptz not null default now()
);

insert into public.calendar_color_settings (
  id,
  daeho_color,
  sanghee_color,
  shared_color,
  private_color
)
values ('calendar', '#7FA99B', '#E9A6AD', '#FFD43B', '#845EF7')
on conflict (id) do nothing;

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  start_at timestamptz not null,
  end_at timestamptz,
  is_all_day boolean not null default false,
  memo text,
  visibility text not null default 'private'
    check (visibility in ('shared', 'private')),
  author_id text not null
    check (author_id in ('daeho', 'sanghee', 'system')),
  event_type text not null default 'normal'
    check (event_type in ('normal', 'anniversary', 'holiday')),
  color_mode text not null default 'default'
    check (color_mode in ('default', 'custom')),
  custom_color text,
  recurrence_rule text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at is null or end_at >= start_at)
);

create index if not exists calendar_events_start_idx
  on public.calendar_events (start_at);
create index if not exists calendar_events_visibility_author_idx
  on public.calendar_events (visibility, author_id);

create table if not exists public.calendar_days_off (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  owner_id text not null references public.profiles(code),
  day_off_type text not null
    check (day_off_type in (
      '연차', '반차', '패밀리데이', '해피프라이데이', '기타 휴무'
    )),
  half_day_period text check (half_day_period in ('am', 'pm')),
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (day_off_type = '반차' and half_day_period is not null)
    or (day_off_type <> '반차' and half_day_period is null)
  )
);

create index if not exists calendar_days_off_date_owner_idx
  on public.calendar_days_off (date, owner_id);

create table if not exists public.calendar_day_backgrounds (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  background_color text not null
    check (background_color ~ '^#[0-9A-Fa-f]{6}$'),
  updated_by text not null references public.profiles(code),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists calendar_day_backgrounds_date_idx
  on public.calendar_day_backgrounds (date);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_code text not null references public.profiles(code) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_code_idx
  on public.push_subscriptions (user_code);

create table if not exists public.push_delivery_log (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null
    references public.push_subscriptions(id) on delete cascade,
  delivery_date date not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (subscription_id, delivery_date)
);

create index if not exists push_delivery_log_date_idx
  on public.push_delivery_log (delivery_date desc);

create table if not exists public.public_holidays (
  date date primary key,
  name text not null,
  is_holiday boolean not null default true,
  source text not null default 'KASI',
  synced_at timestamptz not null default now()
);

create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  memo text,
  due_at timestamptz,
  is_completed boolean not null default false,
  completed_at timestamptz,
  visibility text not null default 'shared'
    check (visibility in ('shared', 'private')),
  author_id text not null references public.profiles(code),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists todos_state_due_idx
  on public.todos (is_completed, due_at);
create index if not exists todos_visibility_author_idx
  on public.todos (visibility, author_id);

create table if not exists public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  quantity numeric(10, 2) not null default 1 check (quantity > 0),
  unit text,
  category text not null default '기타',
  memo text,
  is_purchased boolean not null default false,
  added_by text not null references public.profiles(code),
  purchased_by text references public.profiles(code),
  purchased_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shopping_items_state_created_idx
  on public.shopping_items (is_purchased, created_at desc);

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 160),
  destination text not null,
  country_code text check (
    country_code is null or country_code ~ '^[A-Z]{2}$'
  ),
  start_date date not null,
  end_date date not null,
  memo text,
  author_id text not null references public.profiles(code),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

alter table public.trips
  add column if not exists country_code text;

create index if not exists trips_dates_idx
  on public.trips (start_date, end_date);

create table if not exists public.trip_flights (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  direction text not null default '기타'
    check (direction in ('가는 편', '오는 편', '기타')),
  departure_city text,
  departure_airport text,
  departure_at timestamptz,
  arrival_city text,
  arrival_airport text,
  arrival_at timestamptz,
  airline text,
  flight_number text,
  reservation_number text,
  seat_info text,
  baggage_info text,
  price numeric(14, 2),
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    arrival_at is null or departure_at is null or arrival_at >= departure_at
  )
);

create table if not exists public.trip_accommodations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  name text not null,
  address text,
  map_url text,
  check_in_at timestamptz,
  check_out_at timestamptz,
  reservation_number text,
  price numeric(14, 2),
  contact text,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    check_out_at is null or check_in_at is null or check_out_at >= check_in_at
  )
);

create table if not exists public.trip_transportations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  transport_type text not null,
  title text not null,
  departure_location text,
  departure_at timestamptz,
  arrival_location text,
  arrival_at timestamptz,
  reservation_info text,
  price numeric(14, 2),
  link text,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    arrival_at is null or departure_at is null or arrival_at >= departure_at
  )
);

create table if not exists public.trip_foods (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  name text not null,
  item_type text not null check (item_type in ('음식', '식당')),
  location text,
  link text,
  price_range text,
  is_visited boolean not null default false,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trip_places (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  name text not null,
  category text not null default '기타',
  location text,
  link text,
  desired_date date,
  is_visited boolean not null default false,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fridge_items (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  quantity numeric(10, 2) not null default 1 check (quantity > 0),
  unit text,
  expiration_date date not null,
  storage_type text not null
    check (storage_type in ('냉장', '냉동', '실온', '기타')),
  category text,
  purchased_at date,
  memo text,
  author_id text not null references public.profiles(code),
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fridge_items_expiration_idx
  on public.fridge_items (expiration_date, created_at desc)
  where consumed_at is null;

create table if not exists public.parking_records (
  id uuid primary key default gen_random_uuid(),
  floor text not null check (floor in ('B4', 'B5', 'B6')),
  pillar_letter text not null check (pillar_letter in ('A', 'B', 'C', 'D')),
  pillar_number integer not null check (pillar_number between 1 and 4),
  author_id text not null references public.profiles(code),
  memo text,
  created_at timestamptz not null default now()
);

create index if not exists parking_records_created_idx
  on public.parking_records (created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

alter default privileges in schema public
  grant all privileges on tables to service_role;
alter default privileges in schema public
  grant all privileges on sequences to service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'calendar_color_settings',
    'calendar_events',
    'calendar_days_off',
    'calendar_day_backgrounds',
    'push_subscriptions',
    'todos',
    'shopping_items',
    'trips',
    'trip_flights',
    'trip_accommodations',
    'trip_transportations',
    'trip_foods',
    'trip_places',
    'fridge_items'
  ]
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', table_name);
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      table_name
    );
  end loop;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles',
    'calendar_color_settings',
    'calendar_events',
    'calendar_days_off',
    'calendar_day_backgrounds',
    'push_subscriptions',
    'push_delivery_log',
    'public_holidays',
    'todos',
    'shopping_items',
    'trips',
    'trip_flights',
    'trip_accommodations',
    'trip_transportations',
    'trip_foods',
    'trip_places',
    'fridge_items',
    'parking_records'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
  end loop;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shopping_items'
  ) then
    alter publication supabase_realtime add table public.shopping_items;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'parking_records'
  ) then
    alter publication supabase_realtime add table public.parking_records;
  end if;
end;
$$;

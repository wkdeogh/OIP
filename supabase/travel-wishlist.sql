-- Existing OIP projects: run once in the Supabase SQL Editor.
begin;

create table if not exists public.travel_wishlist (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  is_completed boolean not null default false,
  author_id text not null references public.profiles(code),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists travel_wishlist_state_created_idx
  on public.travel_wishlist (is_completed, created_at desc, id);

drop trigger if exists set_updated_at on public.travel_wishlist;
create trigger set_updated_at before update on public.travel_wishlist
  for each row execute function public.set_updated_at();

alter table public.travel_wishlist enable row level security;
revoke all on public.travel_wishlist from anon, authenticated;
grant select, insert, update, delete on public.travel_wishlist to service_role;

commit;

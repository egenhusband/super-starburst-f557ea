create extension if not exists pgcrypto;

create table if not exists public.kakao_entitlements (
  id uuid primary key default gen_random_uuid(),
  kakao_user_id text not null unique,
  nickname text,
  unlocked boolean not null default false,
  unlocked_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.kakao_entitlements enable row level security;

create index if not exists kakao_entitlements_unlocked_idx
  on public.kakao_entitlements (unlocked);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_kakao_entitlements_updated_at on public.kakao_entitlements;

create trigger set_kakao_entitlements_updated_at
before update on public.kakao_entitlements
for each row
execute function public.set_updated_at();

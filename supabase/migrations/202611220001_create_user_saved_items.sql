-- 내 저장: 카카오 계정별 저장 항목 (계산 결과 · 관심 단지 · 출근지)
-- 이용권 구매 + 카카오 연결 계정만 저장 (API에서 kakao_entitlements.unlocked 확인).
create table if not exists public.user_saved_items (
  kakao_user_id text not null,
  kind text not null
    check (kind in ('calculation', 'apartment', 'commute')),
  item_key text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (kakao_user_id, kind, item_key)
);

create index if not exists user_saved_items_user_updated_idx
  on public.user_saved_items (kakao_user_id, updated_at desc);

alter table public.user_saved_items enable row level security;

revoke all on table public.user_saved_items from anon, authenticated;
grant select, insert, update, delete on table public.user_saved_items to service_role;

drop trigger if exists set_user_saved_items_updated_at
  on public.user_saved_items;

create trigger set_user_saved_items_updated_at
before update on public.user_saved_items
for each row
execute function public.set_updated_at();

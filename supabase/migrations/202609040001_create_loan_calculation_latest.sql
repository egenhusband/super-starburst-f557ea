create table if not exists public.loan_calculation_latest (
  kakao_user_id text primary key
    references public.kakao_entitlements (kakao_user_id) on delete cascade,
  calculator_type text not null
    check (calculator_type in ('fund', 'bank')),
  input_payload jsonb not null,
  schema_version smallint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.loan_calculation_latest enable row level security;

revoke all on table public.loan_calculation_latest from anon, authenticated;
grant select, insert, update, delete on table public.loan_calculation_latest to service_role;

drop trigger if exists set_loan_calculation_latest_updated_at
  on public.loan_calculation_latest;

create trigger set_loan_calculation_latest_updated_at
before update on public.loan_calculation_latest
for each row
execute function public.set_updated_at();

-- ============================================================================
-- Migration 0004: per-job paycheck schedule.
--
-- The Admin sets the specific DATES each job's paychecks arrive. Each dated
-- paycheck drives the per-paycheck cuts (estimated taxes, Safety Reserve,
-- operating costs, commission, remaining). Per-paycheck amounts are derived
-- from the Owner's authoritative ANNUAL estimate divided by the job's
-- pay_periods_per_year; the schedule controls timing (and optional overrides
-- for irregular checks) — it does not change the annual tax estimate.
--
-- Admin manages the schedule (create/generate/edit/delete). Owners get
-- read-only access to their own jobs' schedule via RLS.
-- ============================================================================

create table public.job_paychecks (
  id                        uuid primary key default gen_random_uuid(),
  job_id                    uuid not null references public.jobs (id) on delete cascade,
  pay_date                  date not null,
  period_start              date,
  period_end                date,
  status                    text not null default 'scheduled'
                              check (status in ('scheduled', 'paid', 'skipped')),
  -- Optional override of the expected gross for an irregular paycheck (cents).
  -- When null, the standard per-period gross (annual / pay_periods) is used.
  expected_gross_cents      bigint check (expected_gross_cents >= 0),
  -- Optional actual net received, for reconciliation only.
  actual_net_received_cents bigint check (actual_net_received_cents >= 0),
  notes                     text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (job_id, pay_date),
  constraint job_paychecks_period_range check (period_end is null or period_start is null or period_end >= period_start)
);
create index job_paychecks_job_idx on public.job_paychecks (job_id);
create index job_paychecks_date_idx on public.job_paychecks (pay_date);
create index job_paychecks_job_date_idx on public.job_paychecks (job_id, pay_date);

create trigger job_paychecks_set_updated_at before update on public.job_paychecks
  for each row execute function public.set_updated_at();

alter table public.job_paychecks enable row level security;

create policy job_paychecks_admin_all on public.job_paychecks
  for all using (public.is_admin()) with check (public.is_admin());

create policy job_paychecks_owner_select on public.job_paychecks
  for select using (job_id in (select public.current_owner_job_ids()));

grant select, insert, update, delete on public.job_paychecks to authenticated;

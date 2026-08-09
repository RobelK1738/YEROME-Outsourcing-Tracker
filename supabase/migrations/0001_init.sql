-- ============================================================================
-- Outsourcing Operations Dashboard — initial schema
-- Migration 0001: tables, constraints, indexes, helper functions, RLS policies.
--
-- Money is stored as INTEGER CENTS (bigint). Rates are stored as numeric
-- decimals (e.g. 0.1200 == 12%). Ordinary financial records are never hard
-- deleted; use status/active fields instead.
--
-- SECURITY MODEL
--   * Role lives in the Supabase Auth JWT app_metadata (set only by the
--     service role). is_admin() reads it; it cannot be forged by clients.
--   * Owners are linked to an auth user via owners.auth_user_id.
--   * RLS is enabled on every table. Owners get SELECT-only access to their own
--     records. Admin gets full access. Internal cost details are Admin-only.
-- ============================================================================

-- Needed for gen_random_uuid(); enabled by default on Supabase.
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Early helpers (no table dependencies — required by triggers below)
-- ---------------------------------------------------------------------------

-- Keep updated_at fresh on write.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- True when the caller's JWT carries the admin role in app_metadata.
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin';
$$;

-- ---------------------------------------------------------------------------
-- owners
-- ---------------------------------------------------------------------------
create table public.owners (
  id                            uuid primary key default gen_random_uuid(),
  auth_user_id                  uuid unique references auth.users (id) on delete set null,
  username                      text not null,
  display_name                  text not null,
  filing_status                 text not null default 'single'
                                  check (filing_status in ('single','mfj','mfs','hoh')),
  state                         text not null default 'TX',
  safety_reserve_rate           numeric(5,4) not null default 0.1200
                                  check (safety_reserve_rate >= 0 and safety_reserve_rate <= 1),
  other_income_adjustment_cents bigint not null default 0,
  deduction_adjustment_cents    bigint not null default 0
                                  check (deduction_adjustment_cents >= 0),
  status                        text not null default 'active'
                                  check (status in ('active','inactive','archived')),
  notes                         text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint owners_username_lowercase check (username = lower(username)),
  constraint owners_username_not_blank check (length(trim(username)) > 0)
);
create unique index owners_username_key on public.owners (username);
create index owners_status_idx on public.owners (status);
create trigger owners_set_updated_at before update on public.owners
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- jobs
-- ---------------------------------------------------------------------------
create table public.jobs (
  id                             uuid primary key default gen_random_uuid(),
  owner_id                       uuid not null references public.owners (id) on delete restrict,
  employer_name                  text not null,
  role_title                     text,
  annual_salary_cents            bigint not null default 0 check (annual_salary_cents >= 0),
  projected_tax_year_wages_cents bigint check (projected_tax_year_wages_cents >= 0),
  pay_frequency                  text not null default 'biweekly'
                                   check (pay_frequency in ('weekly','biweekly','semimonthly','monthly')),
  pay_periods_per_year           integer not null default 26 check (pay_periods_per_year > 0),
  safety_reserve_rate            numeric(5,4)
                                   check (safety_reserve_rate >= 0 and safety_reserve_rate <= 1),
  start_date                     date,
  end_date                       date,
  status                         text not null default 'active'
                                   check (status in ('pending','active','paused','ended','archived')),
  notes                          text,
  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now()
);
create index jobs_owner_id_idx on public.jobs (owner_id);
create index jobs_status_idx on public.jobs (status);
create index jobs_owner_status_idx on public.jobs (owner_id, status);
create trigger jobs_set_updated_at before update on public.jobs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- costs (Owner-visible / commercial cost definition)
-- ---------------------------------------------------------------------------
create table public.costs (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid references public.owners (id) on delete set null,
  job_id              uuid references public.jobs (id) on delete cascade,
  name                text not null,
  cost_type           text not null check (cost_type in ('per_job','fixed')),
  cadence             text not null default 'monthly'
                        check (cadence in ('per_paycheck','monthly','annual','one_time')),
  quoted_amount_cents bigint not null default 0 check (quoted_amount_cents >= 0),
  allocation_method   text not null default 'none'
                        check (allocation_method in ('none','equal_all','equal_owner','manual')),
  start_date          date,
  end_date            date,
  active              boolean not null default true,
  owner_visible       boolean not null default true,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Per-job costs must target a job; fixed costs must not.
  constraint costs_type_shape check (
    (cost_type = 'per_job' and job_id is not null) or
    (cost_type = 'fixed' and job_id is null)
  )
);
create index costs_owner_id_idx on public.costs (owner_id);
create index costs_job_id_idx on public.costs (job_id);
create index costs_type_active_idx on public.costs (cost_type, active);
create trigger costs_set_updated_at before update on public.costs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- cost_internal_details (ADMIN ONLY — actual cost + internal notes)
-- Physically separated so Owner-quoted queries never touch actual costs.
-- ---------------------------------------------------------------------------
create table public.cost_internal_details (
  cost_id             uuid primary key references public.costs (id) on delete cascade,
  actual_amount_cents bigint not null default 0 check (actual_amount_cents >= 0),
  internal_notes      text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger cost_internal_details_set_updated_at before update on public.cost_internal_details
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- cost_allocations (explicit fixed-cost -> job weights/percentages)
-- ---------------------------------------------------------------------------
create table public.cost_allocations (
  id                    uuid primary key default gen_random_uuid(),
  cost_id               uuid not null references public.costs (id) on delete cascade,
  job_id                uuid not null references public.jobs (id) on delete cascade,
  allocation_percentage numeric(7,4) not null default 0 check (allocation_percentage >= 0),
  created_at            timestamptz not null default now(),
  unique (cost_id, job_id)
);
create index cost_allocations_cost_idx on public.cost_allocations (cost_id);
create index cost_allocations_job_idx on public.cost_allocations (job_id);

-- ---------------------------------------------------------------------------
-- referrals (Owner -> Owner middleman commission relationships)
-- ---------------------------------------------------------------------------
create table public.referrals (
  id                    uuid primary key default gen_random_uuid(),
  referrer_owner_id     uuid not null references public.owners (id) on delete cascade,
  referred_owner_id     uuid not null references public.owners (id) on delete cascade,
  commission_rate       numeric(5,4) not null default 0.1000 check (commission_rate >= 0),
  commission_basis_type text not null check (commission_basis_type in (
                          'referred_gross_wages','referred_distributable',
                          'selected_jobs','flat_per_paycheck','custom_manual')),
  flat_amount_cents     bigint check (flat_amount_cents >= 0),
  visible_to_referred   boolean not null default false,
  start_date            date,
  end_date              date,
  active                boolean not null default true,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint referrals_no_self check (referrer_owner_id <> referred_owner_id)
);
create index referrals_referrer_idx on public.referrals (referrer_owner_id);
create index referrals_referred_idx on public.referrals (referred_owner_id);
-- Prevent duplicate ACTIVE relationships between the same pair.
create unique index referrals_active_pair_key
  on public.referrals (referrer_owner_id, referred_owner_id)
  where active;
create trigger referrals_set_updated_at before update on public.referrals
  for each row execute function public.set_updated_at();

-- Jobs selected for a 'selected_jobs' commission basis.
create table public.referral_jobs (
  referral_id uuid not null references public.referrals (id) on delete cascade,
  job_id      uuid not null references public.jobs (id) on delete cascade,
  primary key (referral_id, job_id)
);
create index referral_jobs_job_idx on public.referral_jobs (job_id);

-- ---------------------------------------------------------------------------
-- transfer_instructions
--   amount_value semantics by amount_type:
--     fixed         -> integer cents
--     percentage    -> decimal fraction (0.1200 == 12%)
--     calculated    -> ignored (derived at render time)
--     informational -> ignored
-- ---------------------------------------------------------------------------
create table public.transfer_instructions (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references public.owners (id) on delete cascade,
  job_id         uuid references public.jobs (id) on delete cascade,
  label          text not null,
  destination    text,
  payment_method text,
  amount_type    text not null default 'informational'
                   check (amount_type in ('fixed','percentage','calculated','informational')),
  amount_value   numeric(14,4),
  instructions   text,
  sort_order     integer not null default 0,
  active          boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index transfer_instructions_owner_idx on public.transfer_instructions (owner_id);
create index transfer_instructions_job_idx on public.transfer_instructions (job_id);
create trigger transfer_instructions_set_updated_at before update on public.transfer_instructions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- tax_year_settings (configuration by year + filing status)
-- ---------------------------------------------------------------------------
create table public.tax_year_settings (
  year                                integer not null,
  filing_status                       text not null
                                        check (filing_status in ('single','mfj','mfs','hoh')),
  standard_deduction_cents            bigint not null,
  federal_brackets_json               jsonb not null,
  social_security_rate                numeric(6,5) not null,
  social_security_wage_base_cents     bigint not null,
  medicare_rate                       numeric(6,5) not null,
  additional_medicare_rate            numeric(6,5) not null,
  additional_medicare_threshold_cents bigint not null,
  state_income_tax_rate               numeric(6,5) not null default 0,
  created_at                          timestamptz not null default now(),
  updated_at                          timestamptz not null default now(),
  primary key (year, filing_status)
);
create trigger tax_year_settings_set_updated_at before update on public.tax_year_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- pay_cycles + paycheck_entries
-- ---------------------------------------------------------------------------
create table public.pay_cycles (
  id           uuid primary key default gen_random_uuid(),
  label        text,
  period_start date not null,
  period_end   date not null,
  pay_date     date not null,
  status       text not null default 'planned' check (status in ('planned','active','closed')),
  created_at   timestamptz not null default now(),
  constraint pay_cycles_range check (period_end >= period_start)
);
create index pay_cycles_pay_date_idx on public.pay_cycles (pay_date);

create table public.paycheck_entries (
  id                          uuid primary key default gen_random_uuid(),
  pay_cycle_id                uuid not null references public.pay_cycles (id) on delete cascade,
  job_id                      uuid not null references public.jobs (id) on delete cascade,
  expected_gross_cents        bigint not null default 0,
  actual_net_received_cents   bigint,
  estimated_tax_cents         bigint not null default 0,
  safety_reserve_cents        bigint not null default 0,
  quoted_costs_cents          bigint not null default 0,
  commission_in_cents         bigint not null default 0,
  commission_out_cents        bigint not null default 0,
  recommended_remaining_cents bigint not null default 0,
  instruction_snapshot_json   jsonb,
  created_at                  timestamptz not null default now(),
  unique (pay_cycle_id, job_id)
);
create index paycheck_entries_cycle_idx on public.paycheck_entries (pay_cycle_id);
create index paycheck_entries_job_idx on public.paycheck_entries (job_id);

-- ---------------------------------------------------------------------------
-- audit_log (Admin only)
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id            uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  action        text not null,
  entity_type   text,
  entity_id     uuid,
  metadata_json jsonb,
  created_at    timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log (created_at desc);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- RLS helper functions (created AFTER tables — SQL functions resolve relations
-- at CREATE time, so these cannot run before owners/jobs/etc. exist)
-- ---------------------------------------------------------------------------

-- The owner row id for the currently authenticated Owner (SECURITY DEFINER so
-- it can be used inside other tables' policies without RLS recursion).
create or replace function public.current_owner_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.owners where auth_user_id = auth.uid() limit 1;
$$;

-- The set of job ids owned by the current Owner (bypasses jobs RLS safely).
create or replace function public.current_owner_job_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select j.id
  from public.jobs j
  join public.owners o on o.id = j.owner_id
  where o.auth_user_id = auth.uid();
$$;

-- Cost ids that are allocated (via cost_allocations) to the current Owner's
-- jobs. Lets an Owner read the (owner-visible) fixed-cost definition needed to
-- compute their allocated share, even when the cost row itself is not tied to
-- the Owner by owner_id/job_id (e.g. an "equal across all jobs" fixed cost).
create or replace function public.current_owner_allocated_cost_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select distinct ca.cost_id
  from public.cost_allocations ca
  join public.jobs j on j.id = ca.job_id
  join public.owners o on o.id = j.owner_id
  where o.auth_user_id = auth.uid();
$$;

-- Referral ids where the current Owner is the referrer.
create or replace function public.current_owner_referral_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select r.id
  from public.referrals r
  join public.owners o on o.id = r.referrer_owner_id
  where o.auth_user_id = auth.uid();
$$;

-- Whether a cost is flagged Owner-visible (used by allocation policy).
create or replace function public.cost_is_owner_visible(cost uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select owner_visible from public.costs where id = cost), false);
$$;

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.owners                enable row level security;
alter table public.jobs                  enable row level security;
alter table public.costs                 enable row level security;
alter table public.cost_internal_details enable row level security;
alter table public.cost_allocations      enable row level security;
alter table public.referrals             enable row level security;
alter table public.referral_jobs         enable row level security;
alter table public.transfer_instructions enable row level security;
alter table public.tax_year_settings     enable row level security;
alter table public.pay_cycles            enable row level security;
alter table public.paycheck_entries      enable row level security;
alter table public.audit_log             enable row level security;

-- owners
create policy owners_admin_all on public.owners
  for all using (public.is_admin()) with check (public.is_admin());
create policy owners_select_self on public.owners
  for select using (auth_user_id = auth.uid());

-- jobs
create policy jobs_admin_all on public.jobs
  for all using (public.is_admin()) with check (public.is_admin());
create policy jobs_owner_select on public.jobs
  for select using (owner_id = public.current_owner_id());

-- costs (Owner sees only owner_visible costs tied to their owner/jobs)
create policy costs_admin_all on public.costs
  for all using (public.is_admin()) with check (public.is_admin());
create policy costs_owner_select on public.costs
  for select using (
    owner_visible = true
    and (
      owner_id = public.current_owner_id()
      or job_id in (select public.current_owner_job_ids())
      or id in (select public.current_owner_allocated_cost_ids())
    )
  );

-- cost_internal_details: ADMIN ONLY. No Owner policy => Owners get zero rows.
create policy cost_internal_details_admin_all on public.cost_internal_details
  for all using (public.is_admin()) with check (public.is_admin());

-- cost_allocations
create policy cost_allocations_admin_all on public.cost_allocations
  for all using (public.is_admin()) with check (public.is_admin());
create policy cost_allocations_owner_select on public.cost_allocations
  for select using (
    job_id in (select public.current_owner_job_ids())
    and public.cost_is_owner_visible(cost_id)
  );

-- referrals
create policy referrals_admin_all on public.referrals
  for all using (public.is_admin()) with check (public.is_admin());
create policy referrals_owner_select on public.referrals
  for select using (
    referrer_owner_id = public.current_owner_id()
    or (referred_owner_id = public.current_owner_id() and visible_to_referred)
  );

-- referral_jobs
create policy referral_jobs_admin_all on public.referral_jobs
  for all using (public.is_admin()) with check (public.is_admin());
create policy referral_jobs_owner_select on public.referral_jobs
  for select using (referral_id in (select public.current_owner_referral_ids()));

-- transfer_instructions
create policy transfer_instructions_admin_all on public.transfer_instructions
  for all using (public.is_admin()) with check (public.is_admin());
create policy transfer_instructions_owner_select on public.transfer_instructions
  for select using (owner_id = public.current_owner_id() and active = true);

-- tax_year_settings: everyone signed-in may read; only Admin may modify.
create policy tax_year_settings_admin_all on public.tax_year_settings
  for all using (public.is_admin()) with check (public.is_admin());
create policy tax_year_settings_select_auth on public.tax_year_settings
  for select to authenticated using (true);

-- pay_cycles: signed-in read; Admin writes.
create policy pay_cycles_admin_all on public.pay_cycles
  for all using (public.is_admin()) with check (public.is_admin());
create policy pay_cycles_select_auth on public.pay_cycles
  for select to authenticated using (true);

-- paycheck_entries
create policy paycheck_entries_admin_all on public.paycheck_entries
  for all using (public.is_admin()) with check (public.is_admin());
create policy paycheck_entries_owner_select on public.paycheck_entries
  for select using (job_id in (select public.current_owner_job_ids()));

-- audit_log: ADMIN ONLY.
create policy audit_log_admin_all on public.audit_log
  for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================================
-- Grants (RLS still applies on top of these). Anon gets NO table access; all
-- client reads happen as the authenticated user. The service role bypasses RLS
-- and is granted by Supabase automatically.
-- ============================================================================
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to anon, authenticated;

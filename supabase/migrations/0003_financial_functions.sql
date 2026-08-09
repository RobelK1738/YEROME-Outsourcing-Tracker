-- ============================================================================
-- Migration 0003: server-side financial helper functions.
--
-- These SECURITY DEFINER functions exist to compute values that legitimately
-- depend on OTHER Owners' data (e.g. a referral commission based on the referred
-- Owner's wages). They let an Owner see their own earned commission WITHOUT the
-- client ever reading another Owner's protected rows. Access is guarded so a
-- non-admin can only request their own figures.
--
-- The tax NUMBERS themselves come from tax_year_settings (single source of
-- truth). cost_allocations is the single source of truth for fixed-cost splits,
-- read by both this SQL and the JS engine so results stay consistent.
-- ============================================================================

-- Progressive federal income tax (cents) from a bracket JSON array.
create or replace function public.federal_tax_cents(p_taxable bigint, p_brackets jsonb)
returns bigint
language plpgsql
immutable
as $$
declare
  b     jsonb;
  lo    bigint;
  hi    bigint;
  rate  numeric;
  slice bigint;
  tax   numeric := 0;
begin
  if p_taxable is null or p_taxable <= 0 then
    return 0;
  end if;
  for b in select value from jsonb_array_elements(coalesce(p_brackets, '[]'::jsonb)) loop
    lo := coalesce((b->>'min')::bigint, 0);
    hi := case when b->>'max' is null then null else (b->>'max')::bigint end;
    rate := coalesce((b->>'rate')::numeric, 0);
    exit when p_taxable <= lo;
    if hi is null then
      slice := p_taxable - lo;
    else
      slice := least(p_taxable, hi) - lo;
    end if;
    if slice > 0 then
      tax := tax + slice * rate;
    end if;
  end loop;
  return round(tax);
end;
$$;

-- Annualize a cost amount (cents) by its cadence.
create or replace function public.cost_annual_cents(p_amount bigint, p_cadence text)
returns bigint
language sql
immutable
as $$
  select round(coalesce(p_amount, 0) * (case p_cadence
    when 'per_paycheck' then 26
    when 'monthly' then 12
    when 'annual' then 1
    when 'one_time' then 1
    else 1 end))::bigint;
$$;

-- Combined projected annual wages (cents) across an Owner's ACTIVE jobs.
create or replace function public.owner_active_wages_cents(p_owner uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(coalesce(projected_tax_year_wages_cents, annual_salary_cents)), 0)
  from public.jobs
  where owner_id = p_owner and status = 'active';
$$;

-- Owner-quoted operating costs (annual cents): per-job quoted costs for
-- the Owner's active jobs plus their share of fixed costs (from cost_allocations).
create or replace function public.owner_quoted_costs_annual_cents(p_owner uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((
      select sum(public.cost_annual_cents(co.quoted_amount_cents, co.cadence))
      from public.costs co
      join public.jobs j on j.id = co.job_id
      where co.cost_type = 'per_job' and co.active and co.owner_visible
        and j.owner_id = p_owner and j.status = 'active'
    ), 0)
    +
    coalesce((
      select sum(round(public.cost_annual_cents(co.quoted_amount_cents, co.cadence)::numeric
                       * ca.allocation_percentage / 100))
      from public.cost_allocations ca
      join public.costs co on co.id = ca.cost_id
      join public.jobs j on j.id = ca.job_id
      where co.cost_type = 'fixed' and co.active and co.owner_visible
        and j.owner_id = p_owner and j.status = 'active'
    ), 0);
$$;

-- Full Owner financial estimate (cents). Used internally for the
-- 'referred_distributable' commission basis and available for verification.
create or replace function public.owner_financials(p_owner uuid, p_year integer default 2026)
returns table (
  gross_cents         bigint,
  tax_cents           bigint,
  reserve_cents       bigint,
  quoted_costs_cents  bigint,
  distributable_cents bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner   public.owners;
  v_set     public.tax_year_settings;
  v_gross   bigint;
  v_taxable bigint;
  v_tax     bigint;
  v_reserve bigint;
  v_quoted  bigint;
begin
  select * into v_owner from public.owners where id = p_owner;
  if not found then
    return;
  end if;
  select * into v_set from public.tax_year_settings
    where year = p_year and filing_status = v_owner.filing_status;

  v_gross := public.owner_active_wages_cents(p_owner);
  v_taxable := greatest(0, v_gross
    + coalesce(v_owner.other_income_adjustment_cents, 0)
    - coalesce(v_owner.deduction_adjustment_cents, 0)
    - coalesce(v_set.standard_deduction_cents, 0));

  v_tax :=
      public.federal_tax_cents(v_taxable, coalesce(v_set.federal_brackets_json, '[]'::jsonb))
    + round(least(v_gross, coalesce(v_set.social_security_wage_base_cents, 0)) * coalesce(v_set.social_security_rate, 0))
    + round(v_gross * coalesce(v_set.medicare_rate, 0))
    + round(greatest(0, v_gross - coalesce(v_set.additional_medicare_threshold_cents, 0)) * coalesce(v_set.additional_medicare_rate, 0))
    + round(v_taxable * coalesce(v_set.state_income_tax_rate, 0));

  v_reserve := round(v_gross * coalesce(v_owner.safety_reserve_rate, 0));
  v_quoted := public.owner_quoted_costs_annual_cents(p_owner);

  gross_cents := v_gross;
  tax_cents := v_tax;
  reserve_cents := v_reserve;
  quoted_costs_cents := v_quoted;
  distributable_cents := v_gross - v_tax - v_reserve - v_quoted;
  return next;
end;
$$;

-- Earned referral commissions for an Owner (as referrer). Returns only
-- aggregate figures plus the referred Owner's display name — never the referred
-- Owner's individual jobs, costs, or internal data. Guarded so a non-admin can
-- only request their own commissions.
create or replace function public.owner_earned_commissions(p_owner uuid default null, p_year integer default 2026)
returns table (
  referral_id             uuid,
  referred_owner_id       uuid,
  referred_display_name   text,
  commission_rate         numeric,
  commission_basis_type   text,
  flat_amount_cents       bigint,
  basis_annual_cents      bigint,
  annual_commission_cents bigint,
  visible_to_referred     boolean,
  active                  boolean,
  notes                   text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  r       record;
  v_basis bigint;
  v_comm  bigint;
  v_fin   record;
begin
  v_owner := coalesce(p_owner, public.current_owner_id());
  if v_owner is null then
    return;
  end if;
  -- Only Admin may query commissions for an Owner other than themselves.
  if not public.is_admin() and v_owner is distinct from public.current_owner_id() then
    raise exception 'not authorized';
  end if;

  for r in select * from public.referrals where referrer_owner_id = v_owner loop
    if r.commission_basis_type = 'referred_gross_wages' then
      v_basis := public.owner_active_wages_cents(r.referred_owner_id);
      v_comm := round(v_basis * r.commission_rate);
    elsif r.commission_basis_type = 'referred_distributable' then
      select * into v_fin from public.owner_financials(r.referred_owner_id, p_year);
      v_basis := coalesce(v_fin.distributable_cents, 0);
      v_comm := round(v_basis * r.commission_rate);
    elsif r.commission_basis_type = 'selected_jobs' then
      select coalesce(sum(coalesce(j.projected_tax_year_wages_cents, j.annual_salary_cents)), 0)
        into v_basis
        from public.referral_jobs rj
        join public.jobs j on j.id = rj.job_id
        where rj.referral_id = r.id and j.status = 'active';
      v_comm := round(v_basis * r.commission_rate);
    elsif r.commission_basis_type = 'flat_per_paycheck' then
      v_basis := coalesce(r.flat_amount_cents, 0) * 26;
      v_comm := v_basis;
    elsif r.commission_basis_type = 'custom_manual' then
      v_basis := coalesce(r.flat_amount_cents, 0);
      v_comm := v_basis;
    else
      v_basis := 0;
      v_comm := 0;
    end if;

    referral_id := r.id;
    referred_owner_id := r.referred_owner_id;
    select display_name into referred_display_name from public.owners where id = r.referred_owner_id;
    commission_rate := r.commission_rate;
    commission_basis_type := r.commission_basis_type;
    flat_amount_cents := r.flat_amount_cents;
    basis_annual_cents := v_basis;
    annual_commission_cents := case when r.active then v_comm else 0 end;
    visible_to_referred := r.visible_to_referred;
    active := r.active;
    notes := r.notes;
    return next;
  end loop;
end;
$$;

grant execute on function public.federal_tax_cents(bigint, jsonb) to anon, authenticated;
grant execute on function public.cost_annual_cents(bigint, text) to anon, authenticated;
grant execute on function public.owner_active_wages_cents(uuid) to authenticated;
grant execute on function public.owner_quoted_costs_annual_cents(uuid) to authenticated;
grant execute on function public.owner_financials(uuid, integer) to authenticated;
grant execute on function public.owner_earned_commissions(uuid, integer) to authenticated;

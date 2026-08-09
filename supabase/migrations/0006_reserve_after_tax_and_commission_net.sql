-- ============================================================================
-- Migration 0006:
--   * Safety Reserve = rate × (gross − tax)
--   * referred_distributable commission basis = gross − tax − fabricated/quoted costs
-- ============================================================================

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
  v_net     bigint;
begin
  select * into v_owner from public.owners where id = p_owner;
  if not found then
    return;
  end if;
  select * into v_set from public.tax_year_settings
    where year = p_year and filing_status = v_owner.filing_status;

  v_gross := public.owner_active_wages_cents(p_owner);
  v_taxable := greatest(0, v_gross + coalesce(v_owner.other_income_adjustment_cents, 0));

  v_tax :=
      public.federal_tax_cents(v_taxable, coalesce(v_set.federal_brackets_json, '[]'::jsonb))
    + round(least(v_gross, coalesce(v_set.social_security_wage_base_cents, 0)) * coalesce(v_set.social_security_rate, 0))
    + round(v_gross * coalesce(v_set.medicare_rate, 0))
    + round(greatest(0, v_gross - coalesce(v_set.additional_medicare_threshold_cents, 0)) * coalesce(v_set.additional_medicare_rate, 0))
    + round(v_taxable * coalesce(v_set.state_income_tax_rate, 0));

  v_quoted := public.owner_quoted_costs_annual_cents(p_owner);
  -- Reserve on after-tax wages.
  v_reserve := round(greatest(0, v_gross - v_tax) * coalesce(v_owner.safety_reserve_rate, 0));
  -- Net after tax + fabricated costs (commission basis).
  v_net := greatest(0, v_gross - v_tax - v_quoted);

  gross_cents := v_gross;
  tax_cents := v_tax;
  reserve_cents := v_reserve;
  quoted_costs_cents := v_quoted;
  -- Expose net-after-tax-costs via distributable_cents for commission RPC.
  distributable_cents := v_net;
  return next;
end;
$$;

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
  if not public.is_admin() and v_owner is distinct from public.current_owner_id() then
    raise exception 'not authorized';
  end if;

  for r in select * from public.referrals where referrer_owner_id = v_owner loop
    if r.commission_basis_type = 'referred_gross_wages' then
      v_basis := public.owner_active_wages_cents(r.referred_owner_id);
      v_comm := round(v_basis * r.commission_rate);
    elsif r.commission_basis_type = 'referred_distributable' then
      -- Net after tax + fabricated/quoted costs (see owner_financials.distributable_cents).
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

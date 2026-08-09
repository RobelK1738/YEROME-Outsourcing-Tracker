-- ============================================================================
-- Migration 0005: treat projected gross (+ other income adj) as taxable.
-- Standard deduction and deduction adjustments are no longer subtracted.
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
begin
  select * into v_owner from public.owners where id = p_owner;
  if not found then
    return;
  end if;
  select * into v_set from public.tax_year_settings
    where year = p_year and filing_status = v_owner.filing_status;

  v_gross := public.owner_active_wages_cents(p_owner);
  -- Taxable income = projected gross + other income adjustment (no standard deduction).
  v_taxable := greatest(0, v_gross + coalesce(v_owner.other_income_adjustment_cents, 0));

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

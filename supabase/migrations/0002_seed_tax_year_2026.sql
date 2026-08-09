-- ============================================================================
-- Migration 0002: seed 2026 tax configuration for all supported filing statuses.
--
-- Source: IRS Rev. Proc. 2025-32 (tax year 2026, incl. OBBBA amendments).
-- Amounts are INTEGER CENTS; rates are decimals. These values are kept identical
-- to src/lib/calculations/taxConfig2026.js. To add a future year, insert new
-- rows here with the same shape.
--
-- Bracket JSON shape: [{ "rate": 0.10, "min": 0, "max": 1240000 }, ...] where
-- amounts are cents and the top bracket uses "max": null.
-- ============================================================================

insert into public.tax_year_settings (
  year, filing_status, standard_deduction_cents, federal_brackets_json,
  social_security_rate, social_security_wage_base_cents, medicare_rate,
  additional_medicare_rate, additional_medicare_threshold_cents, state_income_tax_rate
) values
-- Single
(2026, 'single', 1610000,
 '[{"rate":0.10,"min":0,"max":1240000},
   {"rate":0.12,"min":1240000,"max":5040000},
   {"rate":0.22,"min":5040000,"max":10570000},
   {"rate":0.24,"min":10570000,"max":20177500},
   {"rate":0.32,"min":20177500,"max":25622500},
   {"rate":0.35,"min":25622500,"max":64060000},
   {"rate":0.37,"min":64060000,"max":null}]'::jsonb,
 0.062, 18450000, 0.0145, 0.009, 20000000, 0),

-- Married Filing Jointly
(2026, 'mfj', 3220000,
 '[{"rate":0.10,"min":0,"max":2480000},
   {"rate":0.12,"min":2480000,"max":10080000},
   {"rate":0.22,"min":10080000,"max":21140000},
   {"rate":0.24,"min":21140000,"max":40355000},
   {"rate":0.32,"min":40355000,"max":51245000},
   {"rate":0.35,"min":51245000,"max":76870000},
   {"rate":0.37,"min":76870000,"max":null}]'::jsonb,
 0.062, 18450000, 0.0145, 0.009, 25000000, 0),

-- Married Filing Separately
(2026, 'mfs', 1610000,
 '[{"rate":0.10,"min":0,"max":1240000},
   {"rate":0.12,"min":1240000,"max":5040000},
   {"rate":0.22,"min":5040000,"max":10570000},
   {"rate":0.24,"min":10570000,"max":20177500},
   {"rate":0.32,"min":20177500,"max":25622500},
   {"rate":0.35,"min":25622500,"max":38435000},
   {"rate":0.37,"min":38435000,"max":null}]'::jsonb,
 0.062, 18450000, 0.0145, 0.009, 12500000, 0),

-- Head of Household
(2026, 'hoh', 2415000,
 '[{"rate":0.10,"min":0,"max":1770000},
   {"rate":0.12,"min":1770000,"max":6745000},
   {"rate":0.22,"min":6745000,"max":10570000},
   {"rate":0.24,"min":10570000,"max":20177500},
   {"rate":0.32,"min":20177500,"max":25620000},
   {"rate":0.35,"min":25620000,"max":64060000},
   {"rate":0.37,"min":64060000,"max":null}]'::jsonb,
 0.062, 18450000, 0.0145, 0.009, 20000000, 0)

on conflict (year, filing_status) do update set
  standard_deduction_cents            = excluded.standard_deduction_cents,
  federal_brackets_json               = excluded.federal_brackets_json,
  social_security_rate                = excluded.social_security_rate,
  social_security_wage_base_cents     = excluded.social_security_wage_base_cents,
  medicare_rate                       = excluded.medicare_rate,
  additional_medicare_rate            = excluded.additional_medicare_rate,
  additional_medicare_threshold_cents = excluded.additional_medicare_threshold_cents,
  state_income_tax_rate               = excluded.state_income_tax_rate,
  updated_at                          = now();

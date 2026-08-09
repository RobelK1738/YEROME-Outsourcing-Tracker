-- ============================================================================
-- DEVELOPMENT seed data. Optional. DO NOT run in production.
--
-- Creates:
--   * Owner A with 8 active jobs @ $50,000/yr each (tests combined-wage taxation)
--   * Owner B with 3 jobs
--   * Owner A -> Owner B referral at 10% of referred gross wages
--   * A per-job worker cost with actual/quoted difference (margin)
--   * A fixed rent cost allocated equally across all active jobs
--   * Safety Reserve overrides + transfer instructions
--
-- Owners are seeded WITHOUT a login (auth_user_id is null) so the Admin can
-- inspect everything immediately. To attach working Owner logins for
-- owner_a / owner_b, run:  npm run seed:dev   (see scripts/seed-dev.mjs).
--
-- Fixed UUIDs are used so the seed is safe to re-run (ON CONFLICT DO NOTHING).
-- ============================================================================

-- Owners --------------------------------------------------------------------
insert into public.owners (id, username, display_name, filing_status, state, safety_reserve_rate, status, notes)
values
  ('11111111-1111-1111-1111-111111111111', 'owner_a', 'Owner A (Demo)', 'single', 'TX', 0.1200, 'active', 'Seed demo owner with 8 jobs.'),
  ('22222222-2222-2222-2222-222222222222', 'owner_b', 'Owner B (Demo)', 'single', 'TX', 0.1200, 'active', 'Seed demo owner referred by Owner A.')
on conflict (id) do nothing;

-- Owner A: 8 active jobs @ $50,000/yr (5,000,000 cents) ----------------------
insert into public.jobs (id, owner_id, employer_name, role_title, annual_salary_cents, pay_frequency, pay_periods_per_year, status, start_date)
values
  ('10000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Acme Support Co.',     'Remote Support Agent', 5000000, 'biweekly', 26, 'active', '2026-01-05'),
  ('10000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Bright Help Inc.',     'Remote Support Agent', 5000000, 'biweekly', 26, 'active', '2026-01-05'),
  ('10000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'CloudCare LLC',        'Remote Support Agent', 5000000, 'biweekly', 26, 'active', '2026-01-05'),
  ('10000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Delta Desk Corp.',     'Remote Support Agent', 5000000, 'biweekly', 26, 'active', '2026-01-05'),
  ('10000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Echo Assist Group',    'Remote Support Agent', 5000000, 'biweekly', 26, 'active', '2026-01-05'),
  ('10000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Foxtrot Service Co.',  'Remote Support Agent', 5000000, 'biweekly', 26, 'active', '2026-01-05'),
  ('10000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'Gamma Care Partners',  'Remote Support Agent', 5000000, 'biweekly', 26, 'active', '2026-01-05'),
  ('10000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'Helio Helpdesk Inc.',  'Remote Support Agent', 5000000, 'biweekly', 26, 'active', '2026-01-05')
on conflict (id) do nothing;

-- Owner B: 3 jobs (varied salaries) -----------------------------------------
insert into public.jobs (id, owner_id, employer_name, role_title, annual_salary_cents, pay_frequency, pay_periods_per_year, status, start_date)
values
  ('20000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Nimbus Support Co.', 'Remote Support Agent', 6200000, 'biweekly', 26, 'active', '2026-02-02'),
  ('20000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Orbit Help LLC',     'Remote Support Agent', 4800000, 'biweekly', 26, 'active', '2026-02-02'),
  ('20000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Pulse Care Inc.',    'Senior Support Agent', 7100000, 'biweekly', 26, 'active', '2026-02-02')
on conflict (id) do nothing;

-- Per-job worker cost on Owner A's first job (actual $700/mo, quoted $1,000/mo)
insert into public.costs (id, owner_id, job_id, name, cost_type, cadence, quoted_amount_cents, allocation_method, active, owner_visible, notes)
values
  ('30000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001',
   'Overseas worker operating charge', 'per_job', 'monthly', 100000, 'none', true, true, 'Monthly quoted operating charge for job support.')
on conflict (id) do nothing;

insert into public.cost_internal_details (cost_id, actual_amount_cents, internal_notes)
values
  ('30000000-0000-0000-0000-000000000001', 70000, 'Actual overseas worker pay is $700/mo; $300/mo internal margin.')
on conflict (cost_id) do nothing;

-- Fixed rent cost, allocated equally across ALL active jobs (actual $2,000/mo, quoted $3,000/mo)
insert into public.costs (id, owner_id, job_id, name, cost_type, cadence, quoted_amount_cents, allocation_method, active, owner_visible, notes)
values
  ('30000000-0000-0000-0000-000000000002', null, null,
   'Shared operations facility charge', 'fixed', 'monthly', 300000, 'equal_all', true, true, 'Shared operational charge allocated across active jobs.')
on conflict (id) do nothing;

insert into public.cost_internal_details (cost_id, actual_amount_cents, internal_notes)
values
  ('30000000-0000-0000-0000-000000000002', 200000, 'Actual office rent is $2,000/mo.')
on conflict (cost_id) do nothing;

-- Fixed-cost allocation across all 11 active jobs (equal split ~9.0909% each).
-- The app recomputes these automatically when jobs change; seeded here so the
-- demo is complete even before running scripts/seed-dev.mjs.
insert into public.cost_allocations (cost_id, job_id, allocation_percentage)
select '30000000-0000-0000-0000-000000000002', id, 9.0909
from public.jobs where status = 'active'
on conflict (cost_id, job_id) do nothing;

-- Referral: Owner A refers Owner B at 10% of referred gross wages -----------
insert into public.referrals (id, referrer_owner_id, referred_owner_id, commission_rate, commission_basis_type, active, notes)
values
  ('40000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
   0.1000, 'referred_gross_wages', true, 'Owner A referred Owner B — 10% of Owner B gross wages.')
on conflict (id) do nothing;

-- Transfer instructions for Owner A (owner-level defaults) -------------------
insert into public.transfer_instructions (id, owner_id, job_id, label, destination, payment_method, amount_type, amount_value, instructions, sort_order, active)
values
  ('50000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', null,
   'Safety Reserve', 'Reserve savings account', 'Internal transfer', 'calculated', null,
   'Move the recommended Safety Reserve amount to your reserve account first.', 1, true),
  ('50000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', null,
   'Operational Charge', 'Operations account', 'Internal transfer', 'calculated', null,
   'Transfer quoted operating charges for the pay period.', 2, true),
  ('50000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', null,
   'Remaining Amount', 'Owner primary account', 'Internal transfer', 'calculated', null,
   'Keep the remaining amount after reserve and operating charges.', 3, true)
on conflict (id) do nothing;

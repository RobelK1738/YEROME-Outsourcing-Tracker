-- ============================================================================
-- Migration 0009: three partnership types + Gang Cut settings + deal quotes.
--
-- Partnerships (owner-quoted split of quoted net):
--   miki_wohabe  → Owner 50% / YEROME 50%   (lower quoted package)
--   three_way    → Owner 40% / Middle 10% / YEROME 50%
--   no_middle    → Owner 50% / YEROME 50%   (higher quoted package)
--
-- Legacy deal_type 'two_way' becomes 'no_middle'.
--
-- Gang Cut is YEROME-internal on every deal:
--   (after-tax × (1 − gang_reserve_rate)) × gang_cut_rate
-- Owners never see it. Defaults 12% then 10%, editable in Settings.
-- ============================================================================

alter table public.owners drop constraint if exists owners_deal_type_check;

update public.owners
  set deal_type = 'no_middle'
  where deal_type = 'two_way';

alter table public.owners
  alter column deal_type set default 'three_way';

alter table public.owners
  add constraint owners_deal_type_check
    check (deal_type in ('miki_wohabe', 'three_way', 'no_middle'));

comment on column public.owners.deal_type is
  'miki_wohabe = 50/50 with Miki quoted package; three_way = 40/10/50; no_middle = 50/50 with higher quoted package.';

-- Quoted amount can differ by deal type (same actuals). Fallback is quoted_amount_cents.
alter table public.cost_templates
  add column if not exists quoted_by_deal jsonb not null default '{}'::jsonb;

-- Singleton business settings (Gang Cut rates).
create table if not exists public.business_settings (
  id                 integer primary key default 1 check (id = 1),
  gang_reserve_rate  numeric(6,4) not null default 0.12
                       check (gang_reserve_rate >= 0 and gang_reserve_rate <= 1),
  gang_cut_rate      numeric(6,4) not null default 0.10
                       check (gang_cut_rate >= 0 and gang_cut_rate <= 1),
  updated_at         timestamptz not null default now()
);

create trigger business_settings_set_updated_at before update on public.business_settings
  for each row execute function public.set_updated_at();

alter table public.business_settings enable row level security;

create policy business_settings_admin_all on public.business_settings
  for all using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.business_settings to authenticated;

insert into public.business_settings (id, gang_reserve_rate, gang_cut_rate)
values (1, 0.12, 0.10)
on conflict (id) do nothing;

-- Deal-specific quoted amounts on the seeded templates. Split Transport + Misc
-- to match the sheet (they used to be one combined template).
update public.cost_templates
  set quoted_by_deal = '{"miki_wohabe": 90000, "three_way": 90000, "no_middle": 110000}'::jsonb,
      quoted_amount_cents = 90000
  where name = 'Rent + WIFI + VPN';

update public.cost_templates
  set quoted_by_deal = '{"miki_wohabe": 40000, "three_way": 40000, "no_middle": 60000}'::jsonb,
      quoted_amount_cents = 40000
  where name = 'Worker Wage';

update public.cost_templates
  set quoted_by_deal = '{"miki_wohabe": 40000, "three_way": 40000, "no_middle": 50000}'::jsonb,
      quoted_amount_cents = 40000
  where name = 'Manager + HR Salary';

-- Replace the combined transport template with two sheet lines if it still exists.
update public.cost_templates
  set name = 'Transportation',
      quoted_amount_cents = 10000,
      actual_amount_cents = 5000,
      quoted_by_deal = '{"miki_wohabe": 10000, "three_way": 10000, "no_middle": 15000}'::jsonb,
      notes = 'Owner-quoted transportation charge.',
      internal_notes = 'Internal actual transportation.'
  where name = 'Transportation + Misc';

insert into public.cost_templates
  (name, cost_type, cadence, quoted_amount_cents, actual_amount_cents,
   allocation_method, owner_visible, is_default, notes, internal_notes, quoted_by_deal)
values
  ('Transportation', 'per_job', 'monthly', 10000, 5000,
   'none', true, true,
   'Owner-quoted transportation charge.',
   'Internal actual transportation.',
   '{"miki_wohabe": 10000, "three_way": 10000, "no_middle": 15000}'::jsonb),
  ('Miscellaneous', 'per_job', 'monthly', 5000, 5000,
   'none', true, true,
   'Owner-quoted miscellaneous charge.',
   'Internal actual miscellaneous.',
   '{"miki_wohabe": 5000, "three_way": 5000, "no_middle": 10000}'::jsonb)
on conflict (name) do update
  set quoted_by_deal = excluded.quoted_by_deal,
      quoted_amount_cents = excluded.quoted_amount_cents,
      actual_amount_cents = excluded.actual_amount_cents,
      is_default = true;

-- ============================================================================
-- Migration 0008: user-managed cost templates.
--
-- Templates were previously hardcoded in the frontend, so adding or repricing a
-- standard charge required a code change. They now live here and are managed
-- from the Costs page.
--
-- A template carries BOTH the owner-quoted amount and the YEROME actual
-- amount, so the whole table is YEROME-only: there is deliberately no Owner
-- policy, exactly like cost_internal_details. Owners get zero rows.
--
-- is_default marks the templates preselected when assigning a package. Combined
-- with cost_type it replaces the two hardcoded "standard package" ID lists:
-- fixed defaults apply to an Owner, per_job defaults apply to a job.
-- ============================================================================

create table public.cost_templates (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  cost_type           text not null check (cost_type in ('per_job','fixed')),
  cadence             text not null default 'monthly'
                        check (cadence in ('per_paycheck','monthly','annual','one_time')),
  quoted_amount_cents bigint not null default 0 check (quoted_amount_cents >= 0),
  actual_amount_cents bigint not null default 0 check (actual_amount_cents >= 0),
  allocation_method   text not null default 'none'
                        check (allocation_method in ('none','equal_all','equal_owner','manual')),
  owner_visible       boolean not null default true,
  is_default          boolean not null default false,
  active              boolean not null default true,
  notes               text,
  internal_notes      text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Two templates with the same name would be indistinguishable in the picker.
  unique (name),
  -- Only fixed costs are spread across jobs; per-job costs sit on one job.
  constraint cost_templates_allocation_shape check (
    cost_type = 'fixed' or allocation_method = 'none'
  )
);
create index cost_templates_type_active_idx on public.cost_templates (cost_type, active);

create trigger cost_templates_set_updated_at before update on public.cost_templates
  for each row execute function public.set_updated_at();

alter table public.cost_templates enable row level security;

-- YEROME only. No Owner policy on purpose: templates expose actual amounts.
create policy cost_templates_admin_all on public.cost_templates
  for all using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.cost_templates to authenticated;

-- Carry over the four templates that used to be hardcoded, so existing setups
-- keep working. They are ordinary rows now: editable, renameable, deletable.
insert into public.cost_templates
  (name, cost_type, cadence, quoted_amount_cents, actual_amount_cents,
   allocation_method, owner_visible, is_default, notes, internal_notes)
values
  ('Rent + WIFI + VPN', 'fixed', 'monthly', 90000, 65000,
   'equal_owner', true, true,
   'Owner-quoted fixed operating charge.',
   'Internal actual facility spend (Rent + WiFi + VPN).'),
  ('Worker Wage', 'per_job', 'monthly', 40000, 20000,
   'none', true, true,
   'Owner-quoted worker operating charge for this job.',
   'Internal actual worker wage.'),
  ('Manager + HR Salary', 'per_job', 'monthly', 40000, 10000,
   'none', true, true,
   'Owner-quoted manager / HR charge for this job.',
   'Internal actual manager + HR allocation.'),
  ('Transportation + Misc', 'per_job', 'monthly', 15000, 10000,
   'none', true, true,
   'Owner-quoted transportation and miscellaneous charge.',
   'Internal actual transportation + misc.')
on conflict (name) do nothing;

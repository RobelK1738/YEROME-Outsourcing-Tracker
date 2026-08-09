-- ============================================================================
-- Migration 0007: Owner deal structure for profit splits.
--
-- Sheet model (YEROME Outsourcing):
--   Gross → Taxes → After-tax → Fabricated costs → Net Profit
--   Net is then split by deal:
--     two_way   → Owner 50% / Ops 50%
--     three_way → Owner 45% / Middle man 10% / Ops 45%
-- Middle-man % still comes from an active referral (default 10% of net).
-- ============================================================================

alter table public.owners
  add column if not exists deal_type text not null default 'three_way'
    check (deal_type in ('two_way', 'three_way')),
  add column if not exists owner_profit_share_rate numeric(6,4)
    check (owner_profit_share_rate is null or (owner_profit_share_rate >= 0 and owner_profit_share_rate <= 1));

comment on column public.owners.deal_type is
  'two_way = Owner/Ops split; three_way = Owner/Middle-man/Ops (sheet model).';
comment on column public.owners.owner_profit_share_rate is
  'Optional override of Owner share of net profit. Null = deal_type default (0.50 or 0.45).';

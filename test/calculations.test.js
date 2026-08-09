// Financial calculation tests. Run with: npm test  (uses Node's built-in
// test runner; no extra dependencies). All amounts are integer cents.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getTaxConfig2026 } from '../src/lib/calculations/taxConfig2026.js';
import {
  projectedOwnerWages,
  taxableIncome,
  federalIncomeTax,
  socialSecurity,
  medicare,
  additionalMedicare,
  stateTax,
  ownerTaxEstimate,
  allocateJobTax,
} from '../src/lib/calculations/tax.js';
import { resolveReserveRate, annualReserve, perPeriodReserve } from '../src/lib/calculations/reserve.js';
import { costMargin, marginPercent, allocateFixedCost, costToAnnual } from '../src/lib/calculations/costs.js';
import { commissionAnnual } from '../src/lib/calculations/commission.js';
import {
  computeOwnerFinancials,
  computeDatedPaycheckPlan,
  computePaycheckRecommendation,
  gangCutCents,
  resolveOwnerProfitShare,
  resolveMiddleShare,
} from '../src/lib/calculations/summary.js';
import { quotedCentsForDeal } from '../src/lib/costTemplates.js';
import { generatePayDates, addDays, addMonths } from '../src/lib/formatting/dates.js';
import { dollarsToCents, annualToBiweekly } from '../src/lib/formatting/money.js';

const SINGLE = getTaxConfig2026('single');
const MFJ = getTaxConfig2026('mfj');

function job(salaryDollars, status = 'active', extra = {}) {
  return { id: Math.random().toString(36).slice(2), status, annual_salary_cents: dollarsToCents(salaryDollars), ...extra };
}

test('one $50k job: wages, taxable income, and progressive federal tax', () => {
  const jobs = [job(50000)];
  const gross = projectedOwnerWages(jobs);
  assert.equal(gross, 5_000_000);

  // Whole gross is taxable (no standard deduction).
  const taxable = taxableIncome(gross, SINGLE);
  assert.equal(taxable, 5_000_000);

  // 10% of 12,400 + 12% of (50,000 - 12,400) = 1,240 + 4,512 = 5,752
  assert.equal(federalIncomeTax(taxable, SINGLE), 575_200);
});

test('eight $50k jobs aggregate to $400k BEFORE progressive taxation', () => {
  const jobs = Array.from({ length: 8 }, () => job(50000));
  const gross = projectedOwnerWages(jobs);
  assert.equal(gross, 40_000_000, 'combined projected wages must equal $400,000');

  const combined = ownerTaxEstimate({ grossWagesCents: gross, settings: SINGLE });

  // Naive (wrong) approach: tax each $50k job independently and sum.
  const perJobTaxable = taxableIncome(5_000_000, SINGLE);
  const naiveFederal = 8 * federalIncomeTax(perJobTaxable, SINGLE);

  // Aggregated federal tax must be substantially higher than the naive sum,
  // because combined income reaches higher marginal brackets.
  assert.ok(
    combined.federalIncomeTaxCents > naiveFederal * 2,
    `aggregated federal (${combined.federalIncomeTaxCents}) should far exceed naive sum (${naiveFederal})`,
  );
});

test('Social Security stops at the 2026 wage base ($184,500)', () => {
  // $400k gross: capped at 184,500 * 6.2% = $11,439
  assert.equal(socialSecurity(40_000_000, SINGLE), 1_143_900);
  // Below the base: full 6.2%
  assert.equal(socialSecurity(5_000_000, SINGLE), Math.round(5_000_000 * 0.062));
});

test('Medicare has no ordinary wage cap', () => {
  assert.equal(medicare(40_000_000, SINGLE), 40_000_000 * 0.0145);
  assert.equal(medicare(100_000_000, SINGLE), 100_000_000 * 0.0145);
});

test('Additional Medicare threshold depends on filing status', () => {
  // Single threshold $200k: (400k - 200k) * 0.9% = $1,800
  assert.equal(additionalMedicare(40_000_000, SINGLE), 180_000);
  // Below threshold => 0
  assert.equal(additionalMedicare(15_000_000, SINGLE), 0);
  // MFJ threshold $250k: (300k - 250k) * 0.9% = $450
  assert.equal(additionalMedicare(30_000_000, MFJ), 45_000);
});

test('Texas state income tax defaults to zero', () => {
  assert.equal(stateTax(40_000_000, SINGLE), 0);
});

test('Safety Reserve default is 12% and priority resolves correctly', () => {
  assert.equal(resolveReserveRate({}), 0.12);
  assert.equal(resolveReserveRate({ ownerRate: 0.1 }), 0.1);
  assert.equal(resolveReserveRate({ ownerRate: 0.1, jobRate: 0.15 }), 0.15); // job override wins
  assert.equal(annualReserve(5_000_000, 0.12), 600_000);
  assert.equal(perPeriodReserve(600_000, 26), Math.round(600_000 / 26));
});

test('Cost margin = quoted - actual', () => {
  assert.equal(costMargin(100_000, 70_000), 30_000);
  assert.equal(marginPercent(100_000, 70_000), 0.3);
  assert.equal(marginPercent(0, 70_000), 0); // no divide-by-zero
});

test('Fixed cost allocation totals equal the original cost', () => {
  const annual = costToAnnual(300_000, 'monthly'); // $3,000/mo -> $36,000/yr
  const jobs = Array.from({ length: 11 }, (_, i) => ({ id: `j${i}`, owner_id: 'o', status: 'active' }));
  const alloc = allocateFixedCost(annual, 'equal_all', jobs);
  const sum = alloc.reduce((s, a) => s + a.cents, 0);
  assert.equal(sum, annual, 'allocations must sum exactly to the annual cost');
  assert.equal(alloc.length, 11);
});

test('equal_owner allocation only targets the scoped Owner active jobs', () => {
  const jobs = [
    { id: 'a1', owner_id: 'A', status: 'active' },
    { id: 'a2', owner_id: 'A', status: 'active' },
    { id: 'b1', owner_id: 'B', status: 'active' },
    { id: 'a3', owner_id: 'A', status: 'ended' },
  ];
  const alloc = allocateFixedCost(1_000_000, 'equal_owner', jobs, { ownerId: 'A' });
  assert.equal(alloc.length, 2);
  assert.equal(alloc.reduce((s, a) => s + a.cents, 0), 1_000_000);
});

test('Owner fixed cost total stays flat while per-job share shrinks with more jobs', () => {
  const annual = costToAnnual(200_000, 'monthly'); // $2,000/mo Rent+WiFi+VPN
  const oneJob = [{ id: 'j1', owner_id: 'A', status: 'active' }];
  const sixJobs = Array.from({ length: 6 }, (_, i) => ({
    id: `j${i + 1}`,
    owner_id: 'A',
    status: 'active',
  }));

  const withOne = allocateFixedCost(annual, 'equal_owner', oneJob, { ownerId: 'A' });
  const withSix = allocateFixedCost(annual, 'equal_owner', sixJobs, { ownerId: 'A' });

  assert.equal(withOne.reduce((s, a) => s + a.cents, 0), annual);
  assert.equal(withSix.reduce((s, a) => s + a.cents, 0), annual);
  assert.equal(withOne[0].cents, annual);
  assert.equal(withSix[0].cents, Math.round(annual / 6));
  assert.ok(withSix[0].cents < withOne[0].cents);
});

test('Referral commission: percentage and flat bases', () => {
  const pct = commissionAnnual(
    { commission_basis_type: 'referred_gross_wages', commission_rate: 0.1 },
    { referredGrossAnnualCents: 6_000_000 },
  );
  assert.equal(pct, 600_000); // 10% of $60,000

  // Default rule: 10% of net after tax + fabricated costs.
  const net = commissionAnnual(
    { commission_basis_type: 'referred_distributable', commission_rate: 0.1 },
    { referredDistributableAnnualCents: 4_000_000 },
  );
  assert.equal(net, 400_000); // 10% of $40,000 net

  const flat = commissionAnnual(
    { commission_basis_type: 'flat_per_paycheck', flat_amount_cents: 10_000 },
    { payPeriods: 26 },
  );
  assert.equal(flat, 260_000); // $100 * 26

  const custom = commissionAnnual({ commission_basis_type: 'custom_manual', flat_amount_cents: 500_000 }, {});
  assert.equal(custom, 500_000);
});

test('Sheet model: net profit split and reserve from Owner share', () => {
  const owner = {
    id: 'o1',
    filing_status: 'single',
    deal_type: 'three_way',
    safety_reserve_rate: 0.12,
    other_income_adjustment_cents: 0,
  };
  const jobs = [{ id: 'j1', status: 'active', annual_salary_cents: 5_000_000, pay_periods_per_year: 26 }];
  // $12k/yr owner-quoted costs
  const fin = computeOwnerFinancials({
    owner,
    jobs,
    settings: SINGLE,
    quotedCostAnnualByJob: { j1: 1_200_000 },
    commissionOutAnnualCents: 0,
  });
  assert.equal(fin.afterTaxAnnualCents, fin.projectedAnnualWagesCents - fin.ownerTax.totalTaxCents);
  assert.equal(fin.netProfitAnnualCents, fin.afterTaxAnnualCents - 1_200_000);
  // 3-way default Owner share 40%, middle man 10%, YEROME 50%
  assert.equal(fin.ownerShareRate, 0.4);
  assert.equal(fin.middleShareRate, 0.1);
  assert.equal(fin.ownerCutAnnualCents, Math.round(fin.netProfitAnnualCents * 0.4));
  assert.equal(fin.commissionOutAnnualCents, Math.round(fin.netProfitAnnualCents * 0.1));
  assert.equal(
    fin.opsDealShareAnnualCents,
    fin.netProfitAnnualCents - fin.ownerCutAnnualCents - fin.commissionOutAnnualCents,
  );
  assert.equal(fin.costMarginAnnualCents, 0);
  // With no cost margin, take-home is paper share minus Gang Cut
  assert.equal(fin.opsCutAnnualCents, Math.max(0, fin.opsDealShareAnnualCents - fin.gangCutAnnualCents));
  // Reserve is planning tip from Owner share
  assert.equal(fin.reserveAnnualCents, Math.round(fin.ownerCutAnnualCents * 0.12));

  const paycheck = computePaycheckRecommendation(fin.jobBreakdowns[0]);
  assert.equal(paycheck.ownerCutCents, Math.round(fin.ownerCutAnnualCents / 26));
  assert.equal(paycheck.safetyReserveCents, Math.round(paycheck.ownerCutCents * 0.12));
});

test('YEROME take-home includes quoted−actual cost margin', () => {
  const owner = {
    id: 'o1',
    filing_status: 'single',
    deal_type: 'no_middle',
    safety_reserve_rate: 0.12,
    other_income_adjustment_cents: 0,
  };
  const jobs = [{ id: 'j1', status: 'active', annual_salary_cents: 5_000_000, pay_periods_per_year: 26 }];
  // Owner sees $12k costs; real spend is $4k → $8k margin to YEROME
  const fin = computeOwnerFinancials({
    owner,
    jobs,
    settings: SINGLE,
    quotedCostAnnualByJob: { j1: 1_200_000 },
    actualCostAnnualByJob: { j1: 400_000 },
    commissionOutAnnualCents: 0,
  });
  assert.equal(fin.costMarginAnnualCents, 800_000);
  assert.equal(fin.ownerShareRate, 0.5);
  assert.equal(fin.ownerCutAnnualCents, Math.round(fin.netProfitAnnualCents * 0.5));
  assert.equal(fin.opsDealShareAnnualCents, fin.netProfitAnnualCents - fin.ownerCutAnnualCents);
  // True YEROME take-home = after-tax − actual − owner − Gang Cut (no middle man on 2-way)
  assert.equal(
    fin.opsCutAnnualCents,
    fin.afterTaxAnnualCents - fin.actualCostsAnnualCents - fin.ownerCutAnnualCents - fin.gangCutAnnualCents,
  );
  assert.equal(fin.opsCutAnnualCents, fin.opsDealShareAnnualCents + 800_000 - fin.gangCutAnnualCents);
  assert.ok(fin.opsCutAnnualCents > fin.ownerCutAnnualCents);

  const paycheck = computePaycheckRecommendation(fin.jobBreakdowns[0]);
  assert.equal(paycheck.costMarginCents, Math.round(800_000 / 26));
  assert.equal(paycheck.gangCutCents, Math.round(fin.gangCutAnnualCents / 26));
});

test('Job tax allocation splits Owner tax by wage ratio and stays consistent', () => {
  const jobs = Array.from({ length: 8 }, () => job(50000));
  const gross = projectedOwnerWages(jobs);
  const est = ownerTaxEstimate({ grossWagesCents: gross, settings: SINGLE });
  const oneJob = allocateJobTax(est, 5_000_000, gross);
  // Each of 8 equal jobs gets ~1/8 of the total.
  assert.ok(Math.abs(oneJob.ratio - 1 / 8) < 1e-9);
  assert.equal(oneJob.totalTaxCents, Math.round(est.totalTaxCents / 8));
});

test('annual/biweekly conversions are consistent', () => {
  assert.equal(annualToBiweekly(2_600_000), 100_000); // 26,000 / 26 = 1,000
});

test('pay date generation spaces dates by frequency', () => {
  assert.deepEqual(generatePayDates('2026-01-02', 3, 'weekly'), ['2026-01-02', '2026-01-09', '2026-01-16']);
  assert.deepEqual(generatePayDates('2026-01-02', 3, 'biweekly'), ['2026-01-02', '2026-01-16', '2026-01-30']);
  assert.equal(generatePayDates('2026-01-31', 2, 'monthly')[1], '2026-02-28'); // clamps to shorter month
  assert.equal(addDays('2026-01-01', 14), '2026-01-15');
  assert.equal(addMonths('2026-01-15', 1), '2026-02-15');
});

test('dated paycheck plan prorates cuts for an irregular gross', () => {
  const jobs = [job(52000)]; // $52,000/yr, 26 periods => $2,000 standard per-period gross
  const fin = computeOwnerFinancials({ owner: { filing_status: 'single' }, jobs, settings: SINGLE });
  const breakdown = fin.jobBreakdowns[0];

  // Standard per-period plan.
  const plan = computeDatedPaycheckPlan(breakdown, null);
  assert.equal(plan.expectedGrossCents, dollarsToCents(2000));

  // A half-size irregular paycheck ($1,000) prorates every cut by 50%.
  const half = computeDatedPaycheckPlan(breakdown, dollarsToCents(1000));
  assert.equal(half.expectedGrossCents, dollarsToCents(1000));
  assert.equal(half.estimatedTaxCents, Math.round(plan.estimatedTaxCents / 2));
  assert.equal(half.safetyReserveCents, Math.round(plan.safetyReserveCents / 2));
});

test('Gang Cut is 10% of after-tax after a 12% safety haircut', () => {
  // Sheet: monthly after-tax $3,368.75 → Gang Cut $296.45
  assert.equal(gangCutCents(336875), 29645);
  assert.equal(gangCutCents(0), 0);
});

test('three partnerships: Miki/no-middle 50/50, 3-way 40/10/50', () => {
  assert.equal(resolveOwnerProfitShare({ deal_type: 'miki_wohabe' }), 0.5);
  assert.equal(resolveMiddleShare({ deal_type: 'miki_wohabe' }), 0);
  assert.equal(resolveOwnerProfitShare({ deal_type: 'three_way' }), 0.4);
  assert.equal(resolveMiddleShare({ deal_type: 'three_way' }), 0.1);
  assert.equal(resolveOwnerProfitShare({ deal_type: 'no_middle' }), 0.5);
  assert.equal(resolveMiddleShare({ deal_type: 'no_middle' }), 0);
  assert.equal(resolveOwnerProfitShare({ deal_type: 'two_way' }), 0.5);
});

test('quoted cost package is higher for No Middle Man deals', () => {
  const worker = {
    quoted_amount_cents: 40000,
    quoted_by_deal: { miki_wohabe: 40000, three_way: 40000, no_middle: 60000 },
  };
  assert.equal(quotedCentsForDeal(worker, 'miki_wohabe'), 40000);
  assert.equal(quotedCentsForDeal(worker, 'three_way'), 40000);
  assert.equal(quotedCentsForDeal(worker, 'no_middle'), 60000);
});

test('3-way YEROME take-home subtracts owner 40%, middle 10%, and Gang Cut', () => {
  const owner = { id: 'o1', filing_status: 'single', deal_type: 'three_way', safety_reserve_rate: 0.12 };
  const jobs = [{ id: 'j1', status: 'active', annual_salary_cents: 5_000_000, pay_periods_per_year: 26 }];
  const fin = computeOwnerFinancials({
    owner,
    jobs,
    settings: SINGLE,
    quotedCostAnnualByJob: { j1: 1_200_000 },
    actualCostAnnualByJob: { j1: 400_000 },
  });
  assert.equal(fin.ownerShareRate, 0.4);
  assert.equal(fin.commissionOutAnnualCents, Math.round(fin.netProfitAnnualCents * 0.1));
  assert.equal(
    fin.opsCutAnnualCents,
    fin.afterTaxAnnualCents -
      fin.actualCostsAnnualCents -
      fin.ownerCutAnnualCents -
      fin.commissionOutAnnualCents -
      fin.gangCutAnnualCents,
  );
});

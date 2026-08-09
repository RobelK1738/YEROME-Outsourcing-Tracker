// Owner / job / paycheck financial orchestration.
//
// Owner-quoted money story (what Owners see):
//   Gross wages − estimated taxes → After-tax
//   After-tax − operating costs (owner-quoted) → Net profit
//   Net is split by deal (Owner share / middle man / YEROME paper share)
//
// YEROME take-home (internal, every deal):
//   after-tax − actual costs − Owner paper share − middle paper share − Gang Cut
//   Gang Cut = after-tax × (1 − gang_reserve_rate) × gang_cut_rate  (Owners never see it)
//
// Safety Reserve is a planning tip from the Owner's share only.

import { annualToMonthly, annualToPayPeriod, roundCents } from '../formatting/money.js';
import {
  ACTIVE_JOB_STATUSES,
  DEFAULT_SAFETY_RESERVE_RATE,
  DEFAULT_DEAL_TYPE,
  DEFAULT_GANG_RESERVE_RATE,
  DEFAULT_GANG_CUT_RATE,
  DEAL_OWNER_SHARE,
  DEAL_MIDDLE_SHARE,
} from '../constants.js';
import { ownerTaxEstimate, projectedOwnerWages, allocateJobTax } from './tax.js';
import { resolveReserveRate } from './reserve.js';

function jobProjectedWages(job) {
  const override = job.projected_tax_year_wages_cents;
  if (override != null && override !== '') return Number(override) || 0;
  return Number(job.annual_salary_cents) || 0;
}

/** Resolve Owner % of net profit from deal type + optional override. */
export function resolveOwnerProfitShare(owner) {
  if (owner?.owner_profit_share_rate != null && owner.owner_profit_share_rate !== '') {
    return Number(owner.owner_profit_share_rate);
  }
  const deal = owner?.deal_type || DEFAULT_DEAL_TYPE;
  return DEAL_OWNER_SHARE[deal] ?? DEAL_OWNER_SHARE.three_way;
}

/** Client-facing middle-man % of quoted net. 0 on both 2-way partnerships. */
export function resolveMiddleShare(owner) {
  const deal = owner?.deal_type || DEFAULT_DEAL_TYPE;
  return DEAL_MIDDLE_SHARE[deal] ?? 0;
}

/**
 * Gang Cut is YEROME-internal on every deal. Sheet: 10% of after-tax after a
 * 12% safety haircut, i.e. afterTax × (1 − 0.12) × 0.10. Owners never see this.
 */
export function gangCutCents(
  afterTaxCents,
  gangReserveRate = DEFAULT_GANG_RESERVE_RATE,
  gangCutRate = DEFAULT_GANG_CUT_RATE,
) {
  const afterTax = Math.max(0, Number(afterTaxCents) || 0);
  const reserve = Math.min(1, Math.max(0, Number(gangReserveRate) || 0));
  const cut = Math.min(1, Math.max(0, Number(gangCutRate) || 0));
  return roundCents(afterTax * (1 - reserve) * cut);
}

/**
 * Compute an Owner's complete financial picture.
 *
 * @param {number} params.commissionOutAnnualCents - middle-man commission paid
 *   out of this Owner's net (when they were referred), annual cents.
 * @param {Record<string, number>} [params.actualCostAnnualByJob] - Admin-only
 *   real costs per job. When omitted, actual defaults to quoted (no margin).
 */
export function computeOwnerFinancials({
  owner,
  jobs = [],
  settings,
  quotedCostAnnualByJob = {},
  actualCostAnnualByJob = null,
  commissionOutAnnualCents = 0,
  commissionEarnedAnnualCents = 0,
  systemReserveDefault = DEFAULT_SAFETY_RESERVE_RATE,
  gangReserveRate = DEFAULT_GANG_RESERVE_RATE,
  gangCutRate = DEFAULT_GANG_CUT_RATE,
}) {
  const activeJobs = jobs.filter((j) => ACTIVE_JOB_STATUSES.includes(j.status));
  const projectedAnnualWagesCents = projectedOwnerWages(jobs);

  const ownerTax = ownerTaxEstimate({
    grossWagesCents: projectedAnnualWagesCents,
    settings,
    otherIncomeAdjCents: owner?.other_income_adjustment_cents || 0,
  });

  const afterTaxAnnualCents = Math.max(0, projectedAnnualWagesCents - ownerTax.totalTaxCents);
  const ownerReserveRate = resolveReserveRate({
    ownerRate: owner?.safety_reserve_rate,
    systemDefault: systemReserveDefault,
  });
  const ownerShareRate = resolveOwnerProfitShare(owner);
  const middleShareRate = resolveMiddleShare(owner);

  const quotedCostsAnnualCents = activeJobs.reduce(
    (s, j) => s + (Number(quotedCostAnnualByJob[j.id]) || 0),
    0,
  );

  // Owner-quoted net uses owner-quoted costs only.
  const netProfitAnnualCents = Math.max(0, afterTaxAnnualCents - quotedCostsAnnualCents);

  // Deal split of quoted net. 3-way middle man is 10% of that net (not a stacked
  // referral). Referral rows still name who gets paid; they do not add a second cut.
  const ownerCutAnnualCents = roundCents(netProfitAnnualCents * ownerShareRate);
  const dealMiddleAnnualCents = roundCents(netProfitAnnualCents * middleShareRate);
  const referralOut = Math.max(0, Number(commissionOutAnnualCents) || 0);
  const commissionOutClamped =
    dealMiddleAnnualCents > 0
      ? dealMiddleAnnualCents
      : Math.min(referralOut, Math.max(0, netProfitAnnualCents - ownerCutAnnualCents));

  // Paper YEROME share of the owner-quoted net.
  const opsDealShareAnnualCents = Math.max(
    0,
    netProfitAnnualCents - ownerCutAnnualCents - commissionOutClamped,
  );

  // YEROME actual costs: when not supplied, treat actual = quoted (no invented margin).
  const actualCostsAnnualCents = activeJobs.reduce((s, j) => {
    const quoted = Number(quotedCostAnnualByJob[j.id]) || 0;
    if (actualCostAnnualByJob && Object.prototype.hasOwnProperty.call(actualCostAnnualByJob, j.id)) {
      return s + Math.max(0, Number(actualCostAnnualByJob[j.id]) || 0);
    }
    return s + quoted;
  }, 0);

  const costMarginAnnualCents = quotedCostsAnnualCents - actualCostsAnnualCents;
  const gangCutAnnualCents = gangCutCents(afterTaxAnnualCents, gangReserveRate, gangCutRate);

  // True YEROME take-home: after-tax − actual costs − owner paper − middle paper − Gang Cut.
  const opsCutAnnualCents = Math.max(
    0,
    afterTaxAnnualCents -
      actualCostsAnnualCents -
      ownerCutAnnualCents -
      commissionOutClamped -
      gangCutAnnualCents,
  );

  // Reserve is recommended from the Owner's cut (planning), not a pre-net cut.
  const reserveAnnualCents = roundCents(ownerCutAnnualCents * ownerReserveRate);

  const jobBreakdowns = activeJobs.map((job) => {
    const wages = jobProjectedWages(job);
    const taxAllocation = allocateJobTax(ownerTax, wages, projectedAnnualWagesCents);
    const ratio = projectedAnnualWagesCents > 0 ? wages / projectedAnnualWagesCents : 0;
    const payPeriods = Number(job.pay_periods_per_year) > 0 ? Number(job.pay_periods_per_year) : 26;
    const quotedCostAnnual = Number(quotedCostAnnualByJob[job.id]) || 0;
    const actualCostAnnual =
      actualCostAnnualByJob && Object.prototype.hasOwnProperty.call(actualCostAnnualByJob, job.id)
        ? Math.max(0, Number(actualCostAnnualByJob[job.id]) || 0)
        : quotedCostAnnual;
    const afterTaxJob = Math.max(0, wages - taxAllocation.totalTaxCents);
    const netJob = Math.max(0, afterTaxJob - quotedCostAnnual);
    const ownerCutJob = roundCents(ownerCutAnnualCents * ratio);
    const commissionOutJob = roundCents(commissionOutClamped * ratio);
    const opsDealShareJob = roundCents(opsDealShareAnnualCents * ratio);
    const costMarginJob = quotedCostAnnual - actualCostAnnual;
    const gangCutJob = roundCents(gangCutAnnualCents * ratio);
    const opsCutJob = Math.max(0, afterTaxJob - actualCostAnnual - ownerCutJob - commissionOutJob - gangCutJob);
    const reserveJob = roundCents(ownerCutJob * ownerReserveRate);

    return {
      job,
      wagesAnnualCents: wages,
      payPeriods,
      ratio,
      taxAllocation,
      afterTaxAnnualCents: afterTaxJob,
      quotedCostAnnualCents: quotedCostAnnual,
      actualCostAnnualCents: actualCostAnnual,
      costMarginAnnualCents: costMarginJob,
      netProfitAnnualCents: netJob,
      ownerCutAnnualCents: ownerCutJob,
      commissionOutAnnualCents: commissionOutJob,
      opsDealShareAnnualCents: opsDealShareJob,
      gangCutAnnualCents: gangCutJob,
      opsCutAnnualCents: opsCutJob,
      reserveRate: ownerReserveRate,
      reserveAnnualCents: reserveJob,
      remainingAnnualCents: ownerCutJob,
    };
  });

  return {
    activeJobCount: activeJobs.length,
    dealType: owner?.deal_type || DEFAULT_DEAL_TYPE,
    ownerShareRate,
    middleShareRate,
    projectedAnnualWagesCents,
    ownerTax,
    afterTaxAnnualCents,
    quotedCostsAnnualCents,
    actualCostsAnnualCents,
    costMarginAnnualCents,
    netProfitAnnualCents,
    ownerCutAnnualCents,
    commissionOutAnnualCents: commissionOutClamped,
    opsDealShareAnnualCents,
    gangCutAnnualCents,
    gangReserveRate,
    gangCutRate,
    opsCutAnnualCents,
    commissionEarnedAnnualCents: Number(commissionEarnedAnnualCents) || 0,
    ownerReserveRate,
    reserveAnnualCents,
    reserveMonthlyCents: annualToMonthly(reserveAnnualCents),
    estimatedRemainingAnnualCents: ownerCutAnnualCents,
    distributableAnnualCents: netProfitAnnualCents,
    netAfterTaxCostsAnnualCents: netProfitAnnualCents,
    jobBreakdowns,
  };
}

export function computeJobSummary(breakdown) {
  const { wagesAnnualCents, payPeriods } = breakdown;
  return {
    incomeAnnualCents: wagesAnnualCents,
    incomeMonthlyCents: annualToMonthly(wagesAnnualCents),
    incomePerPeriodCents: annualToPayPeriod(wagesAnnualCents, payPeriods),
    ...breakdown,
  };
}

/**
 * Paycheck recommendation for one job.
 * Owner-quoted "keep" = their profit share for the period.
 * Reserve is an advisory set-aside from that keep.
 * opsCutCents is YEROME true take-home for the period (deal share + cost margin).
 */
/** Convert a job's annual tax allocation into per-paycheck component amounts. */
function taxAllocationPerPaycheck(taxAllocation, payPeriods) {
  const periods = payPeriods > 0 ? payPeriods : 26;
  const alloc = taxAllocation || {};
  return {
    federalIncomeTaxCents: annualToPayPeriod(alloc.federalIncomeTaxCents || 0, periods),
    socialSecurityCents: annualToPayPeriod(alloc.socialSecurityCents || 0, periods),
    medicareCents: annualToPayPeriod(alloc.medicareCents || 0, periods),
    additionalMedicareCents: annualToPayPeriod(alloc.additionalMedicareCents || 0, periods),
    stateTaxCents: annualToPayPeriod(alloc.stateTaxCents || 0, periods),
    totalTaxCents: annualToPayPeriod(alloc.totalTaxCents || 0, periods),
    ratio: alloc.ratio,
  };
}

export function computePaycheckRecommendation(breakdown) {
  const payPeriods = breakdown.payPeriods > 0 ? breakdown.payPeriods : 26;
  const expectedGross = annualToPayPeriod(breakdown.wagesAnnualCents, payPeriods);
  const taxBreakdown = taxAllocationPerPaycheck(breakdown.taxAllocation, payPeriods);
  const estimatedTax = taxBreakdown.totalTaxCents;
  const afterTax = Math.max(0, expectedGross - estimatedTax);
  const quotedCosts = annualToPayPeriod(breakdown.quotedCostAnnualCents, payPeriods);
  const actualCosts = annualToPayPeriod(breakdown.actualCostAnnualCents ?? breakdown.quotedCostAnnualCents, payPeriods);
  const costMargin = quotedCosts - actualCosts;
  const netProfit = Math.max(0, afterTax - quotedCosts);
  const ownerCut = annualToPayPeriod(breakdown.ownerCutAnnualCents, payPeriods);
  const commissionOut = annualToPayPeriod(breakdown.commissionOutAnnualCents, payPeriods);
  const opsDealShare = annualToPayPeriod(
    breakdown.opsDealShareAnnualCents ?? Math.max(0, (breakdown.opsCutAnnualCents || 0) - (breakdown.costMarginAnnualCents || 0)),
    payPeriods,
  );
  const opsCut = annualToPayPeriod(breakdown.opsCutAnnualCents, payPeriods);
  const gangCut = annualToPayPeriod(breakdown.gangCutAnnualCents || 0, payPeriods);
  const reserve = roundCents(ownerCut * (Number(breakdown.reserveRate) || 0));

  return {
    payPeriods,
    expectedGrossCents: expectedGross,
    estimatedTaxCents: estimatedTax,
    taxBreakdown,
    afterTaxCents: afterTax,
    quotedCostsCents: quotedCosts,
    actualCostsCents: actualCosts,
    costMarginCents: costMargin,
    netProfitCents: netProfit,
    ownerCutCents: ownerCut,
    commissionOutCents: commissionOut,
    opsDealShareCents: opsDealShare,
    gangCutCents: gangCut,
    opsCutCents: opsCut,
    safetyReserveCents: reserve,
    recommendedRemainingCents: ownerCut,
    keepAfterReserveCents: Math.max(0, ownerCut - reserve),
  };
}

export function computeDatedPaycheckPlan(breakdown, expectedGrossOverrideCents = null) {
  const base = computePaycheckRecommendation(breakdown);
  const override = expectedGrossOverrideCents;
  if (override == null || override === '' || Number(override) < 0) return base;

  const overrideCents = Number(override);
  const stdGross = base.expectedGrossCents;
  const ratio = stdGross > 0 ? overrideCents / stdGross : 0;
  const tax = roundCents(base.estimatedTaxCents * ratio);
  const taxBreakdown = base.taxBreakdown
    ? {
        federalIncomeTaxCents: roundCents(base.taxBreakdown.federalIncomeTaxCents * ratio),
        socialSecurityCents: roundCents(base.taxBreakdown.socialSecurityCents * ratio),
        medicareCents: roundCents(base.taxBreakdown.medicareCents * ratio),
        additionalMedicareCents: roundCents(base.taxBreakdown.additionalMedicareCents * ratio),
        stateTaxCents: roundCents(base.taxBreakdown.stateTaxCents * ratio),
        totalTaxCents: tax,
        ratio: base.taxBreakdown.ratio,
      }
    : null;
  const afterTax = Math.max(0, overrideCents - tax);
  const quotedCosts = roundCents(base.quotedCostsCents * ratio);
  const actualCosts = roundCents(base.actualCostsCents * ratio);
  const costMargin = quotedCosts - actualCosts;
  const netProfit = Math.max(0, afterTax - quotedCosts);
  const ownerCut = roundCents(base.ownerCutCents * ratio);
  const commissionOut = roundCents(base.commissionOutCents * ratio);
  const opsDealShare = roundCents(base.opsDealShareCents * ratio);
  const opsCut = roundCents(base.opsCutCents * ratio);
  const gangCut = roundCents((base.gangCutCents || 0) * ratio);
  const reserve = roundCents(ownerCut * (Number(breakdown.reserveRate) || 0));

  return {
    ...base,
    expectedGrossCents: overrideCents,
    estimatedTaxCents: tax,
    taxBreakdown,
    afterTaxCents: afterTax,
    quotedCostsCents: quotedCosts,
    actualCostsCents: actualCosts,
    costMarginCents: costMargin,
    netProfitCents: netProfit,
    ownerCutCents: ownerCut,
    commissionOutCents: commissionOut,
    opsDealShareCents: opsDealShare,
    gangCutCents: gangCut,
    opsCutCents: opsCut,
    safetyReserveCents: reserve,
    recommendedRemainingCents: ownerCut,
    keepAfterReserveCents: Math.max(0, ownerCut - reserve),
    prorated: true,
  };
}

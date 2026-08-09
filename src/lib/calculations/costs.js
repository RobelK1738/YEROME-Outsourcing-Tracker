// Cost conversion, margin, and fixed-cost allocation. All money is cents.
//
// Admin-only values (actual cost, margin) are computed here but the data layer
// and RLS ensure Owners never receive the underlying actual amounts.

import { roundCents, annualToMonthly, annualToPayPeriod } from '../formatting/money.js';
import { ACTIVE_JOB_STATUSES } from '../constants.js';

// Standard periods-per-year assumptions used to annualize recurring costs.
// Costs use a cadence (not a per-job pay frequency), so we assume biweekly (26)
// for "per paycheck". Documented assumption; see README.
const CADENCE_ANNUAL_MULTIPLIER = {
  per_paycheck: 26,
  monthly: 12,
  annual: 1,
  one_time: 1, // Counted once within the tax/operating year.
};

/** Annualize a cost amount (cents) given its cadence. */
export function costToAnnual(amountCents, cadence) {
  const multiplier = CADENCE_ANNUAL_MULTIPLIER[cadence] ?? 1;
  return roundCents((Number(amountCents) || 0) * multiplier);
}

/** Full recurring-cost conversion: annual / monthly / biweekly (cents). */
export function convertCost(amountCents, cadence) {
  const annual = costToAnnual(amountCents, cadence);
  return {
    annualCents: annual,
    monthlyCents: annualToMonthly(annual),
    biweeklyCents: annualToPayPeriod(annual, 26),
  };
}

/** Internal margin (cents) = quoted - actual. */
export function costMargin(quotedCents, actualCents) {
  return (Number(quotedCents) || 0) - (Number(actualCents) || 0);
}

/** Margin as a fraction of quoted price (decimal). Returns 0 if quoted is 0. */
export function marginPercent(quotedCents, actualCents) {
  const quoted = Number(quotedCents) || 0;
  if (quoted === 0) return 0;
  return costMargin(quotedCents, actualCents) / quoted;
}

/**
 * Full Admin-only margin breakdown for one cost, at annual/monthly/biweekly.
 */
export function marginBreakdown({ quotedAmountCents, actualAmountCents, cadence }) {
  const quoted = convertCost(quotedAmountCents, cadence);
  const actual = convertCost(actualAmountCents, cadence);
  return {
    quotedAnnualCents: quoted.annualCents,
    actualAnnualCents: actual.annualCents,
    marginAnnualCents: quoted.annualCents - actual.annualCents,
    marginMonthlyCents: quoted.monthlyCents - actual.monthlyCents,
    marginBiweeklyCents: quoted.biweeklyCents - actual.biweeklyCents,
    marginPercent: marginPercent(quotedAmountCents, actualAmountCents),
  };
}

/**
 * Allocate a fixed cost's ANNUAL amount across jobs.
 *
 * @param {number} annualCents - annualized amount to distribute
 * @param {string} method - 'equal_all' | 'equal_owner' | 'manual'
 * @param {Array}  jobs - candidate jobs [{ id, owner_id, status }]
 * @param {object} opts - { ownerId, manualAllocations: [{ job_id, allocation_percentage }] }
 * @returns {Array} [{ jobId, cents }] — the sum ALWAYS equals annualCents
 *          (any rounding remainder is added to the last allocation).
 */
export function allocateFixedCost(annualCents, method, jobs = [], opts = {}) {
  const total = roundCents(Number(annualCents) || 0);
  const active = jobs.filter((j) => ACTIVE_JOB_STATUSES.includes(j.status));

  let targets = [];
  if (method === 'equal_all') {
    targets = active.map((j) => ({ jobId: j.id, weight: 1 }));
  } else if (method === 'equal_owner') {
    targets = active
      .filter((j) => j.owner_id === opts.ownerId)
      .map((j) => ({ jobId: j.id, weight: 1 }));
  } else if (method === 'manual') {
    targets = (opts.manualAllocations || []).map((a) => ({
      jobId: a.job_id,
      weight: Number(a.allocation_percentage) || 0,
    }));
  }

  const totalWeight = targets.reduce((s, t) => s + t.weight, 0);
  if (targets.length === 0 || totalWeight <= 0) return [];

  // Distribute proportionally, then push any rounding remainder to the last row
  // so the allocations sum EXACTLY to the original total.
  let allocated = 0;
  const result = targets.map((t, i) => {
    let cents;
    if (i === targets.length - 1) {
      cents = total - allocated;
    } else {
      cents = roundCents((total * t.weight) / totalWeight);
      allocated += cents;
    }
    return { jobId: t.jobId, cents };
  });
  return result;
}

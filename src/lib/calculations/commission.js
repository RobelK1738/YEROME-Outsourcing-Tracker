// Referral / middleman commission calculations. All money is cents; rates are
// decimals. Commissions recalculate automatically because they are derived from
// the current stored financial values passed in via `context` (PRD 13).

import { roundCents, annualToMonthly, annualToPayPeriod } from '../formatting/money.js';

/**
 * Resolve the ANNUAL basis amount (cents) a commission percentage applies to,
 * or the annual flat/custom total when the basis is not percentage-based.
 *
 * @param {object} referral - { commission_basis_type, commission_rate, flat_amount_cents }
 * @param {object} context - {
 *     referredGrossAnnualCents,          // referred Owner's combined gross wages
 *     referredDistributableAnnualCents,  // referred net after tax + fabricated costs (annual)
 *     selectedJobsAnnualCents,           // sum of wages for referral's selected jobs
 *     payPeriods,                        // pay periods per year (for flat/paycheck)
 *   }
 *
 * Default business rule: 10% of referred Owner monthly net after tax and
 * fabricated (quoted) costs — stored as an annual % of that same annual net.
 */
export function commissionAnnual(referral, context = {}) {
  const rate = Number(referral?.commission_rate) || 0;
  const flat = Number(referral?.flat_amount_cents) || 0;
  const payPeriods = Number(context.payPeriods) > 0 ? Number(context.payPeriods) : 26;

  switch (referral?.commission_basis_type) {
    case 'referred_gross_wages':
      return roundCents((Number(context.referredGrossAnnualCents) || 0) * rate);
    case 'referred_distributable':
      // Net profit after tax + fabricated/quoted costs (annual).
      return roundCents((Number(context.referredDistributableAnnualCents) || 0) * rate);
    case 'selected_jobs':
      return roundCents((Number(context.selectedJobsAnnualCents) || 0) * rate);
    case 'flat_per_paycheck':
      return roundCents(flat * payPeriods);
    case 'custom_manual':
      return roundCents(flat);
    default:
      return 0;
  }
}

/** Full commission breakdown: annual / monthly / biweekly (cents). */
export function commissionBreakdown(referral, context = {}) {
  const annual = commissionAnnual(referral, context);
  return {
    annualCents: annual,
    monthlyCents: annualToMonthly(annual),
    biweeklyCents: annualToPayPeriod(annual, context.payPeriods || 26),
  };
}

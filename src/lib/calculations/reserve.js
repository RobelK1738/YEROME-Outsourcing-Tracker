// Safety Reserve calculations. The Safety Reserve is a business planning
// recommendation and is intentionally kept SEPARATE from taxes (PRD 3.5 / 15).
// All monetary values are cents; rates are decimals.

import { roundCents } from '../formatting/money.js';
import { DEFAULT_SAFETY_RESERVE_RATE } from '../constants.js';

/**
 * Resolve the applicable reserve rate using the priority:
 *   job override -> owner value -> system default (12%).
 * A value of null/undefined means "not set" at that level.
 */
export function resolveReserveRate({ jobRate, ownerRate, systemDefault = DEFAULT_SAFETY_RESERVE_RATE } = {}) {
  if (jobRate != null && jobRate !== '') return Number(jobRate);
  if (ownerRate != null && ownerRate !== '') return Number(ownerRate);
  return Number(systemDefault);
}

/**
 * Annual reserve (cents) = base * rate.
 * Callers should pass AFTER-TAX wages as the base (not gross).
 */
export function annualReserve(baseCents, rate) {
  return roundCents((Number(baseCents) || 0) * (Number(rate) || 0));
}

/** Monthly reserve (cents) = annual / 12. */
export function monthlyReserve(annualReserveCents) {
  return roundCents((Number(annualReserveCents) || 0) / 12);
}

/** Per-pay-period reserve (cents) = annual / payPeriods. */
export function perPeriodReserve(annualReserveCents, payPeriods) {
  const periods = Number(payPeriods) > 0 ? Number(payPeriods) : 1;
  return roundCents((Number(annualReserveCents) || 0) / periods);
}

/** Convenience: full reserve breakdown for a job/owner context. */
export function reserveBreakdown({ wagesCents, jobRate, ownerRate, systemDefault, payPeriods = 26 }) {
  const rate = resolveReserveRate({ jobRate, ownerRate, systemDefault });
  const annual = annualReserve(wagesCents, rate);
  return {
    rate,
    annualCents: annual,
    monthlyCents: monthlyReserve(annual),
    perPeriodCents: perPeriodReserve(annual, payPeriods),
  };
}

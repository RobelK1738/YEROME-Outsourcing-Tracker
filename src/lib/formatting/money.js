// Centralized monetary helpers.
//
// RULE: business money is stored and passed around as INTEGER CENTS.
// Never treat a raw dollar float as the primary representation. All rounding
// happens here so the rest of the app shares one consistent rounding policy.

/** Round to the nearest whole cent. Uses half-away-from-zero. */
export function roundCents(cents) {
  if (!Number.isFinite(cents)) return 0;
  return Math.round(cents);
}

/** Convert a dollar amount (number or numeric string) into integer cents. */
export function dollarsToCents(dollars) {
  const n = typeof dollars === 'string' ? parseFloat(dollars) : dollars;
  if (!Number.isFinite(n)) return 0;
  // Multiply then round to avoid binary floating point drift (e.g. 19.99 * 100).
  return Math.round(n * 100);
}

/** Convert integer cents into a dollar number (may have decimals). */
export function centsToDollars(cents) {
  if (!Number.isFinite(cents)) return 0;
  return cents / 100;
}

const etbCurrencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'ETB',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Format integer cents as a USD currency string, e.g. 5000000 -> "$50,000.00". */
export function etbFormatCurrency(cents) {
  return etbCurrencyFormatter.format(centsToDollars(roundCents(cents)));
}

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format integer cents as a USD currency string, e.g. 5000000 -> "$50,000.00". */
export function formatCurrency(cents) {
  return currencyFormatter.format(centsToDollars(roundCents(cents)));
}

/** Format a decimal rate (0.12) as a percent string ("12%"). */
export function formatPercent(rate, fractionDigits = 2) {
  if (!Number.isFinite(rate)) return '0%';
  const pct = rate * 100;
  // Trim trailing zeros for whole percentages while keeping precision otherwise.
  const rounded = Number(pct.toFixed(fractionDigits));
  return `${rounded}%`;
}

/** Annual cents -> monthly cents (rounded). */
export function annualToMonthly(cents) {
  return roundCents(centsCoerce(cents) / 12);
}

/** Annual cents -> per-pay-period cents (rounded). */
export function annualToPayPeriod(cents, payPeriods) {
  const periods = Number(payPeriods) > 0 ? Number(payPeriods) : 1;
  return roundCents(centsCoerce(cents) / periods);
}

/** Annual cents -> biweekly cents (26 periods), a convenience wrapper. */
export function annualToBiweekly(cents) {
  return annualToPayPeriod(cents, 26);
}

function centsCoerce(cents) {
  return Number.isFinite(cents) ? cents : 0;
}

// 2026 federal tax configuration, expressed in INTEGER CENTS and decimal rates.
//
// Source: IRS Rev. Proc. 2025-32 (tax year 2026 inflation adjustments, including
// OBBBA amendments). This module is the single JS-side definition of the 2026
// numbers and is kept identical to the values seeded into `tax_year_settings`
// by supabase/migrations/0002_seed_tax_year_2026.sql. The DATABASE is the
// runtime source of truth; this file is used by pure calculation tests and as a
// typed reference. To add a future year, add a new config object + a new seed.

// Bracket shape: { rate, min, max } where amounts are cents and `max: null`
// means the top (open-ended) bracket.
const SINGLE_BRACKETS = [
  { rate: 0.1, min: 0, max: 1_240_000 },
  { rate: 0.12, min: 1_240_000, max: 5_040_000 },
  { rate: 0.22, min: 5_040_000, max: 10_570_000 },
  { rate: 0.24, min: 10_570_000, max: 20_177_500 },
  { rate: 0.32, min: 20_177_500, max: 25_622_500 },
  { rate: 0.35, min: 25_622_500, max: 64_060_000 },
  { rate: 0.37, min: 64_060_000, max: null },
];

// MFS shares Single's brackets except the top two split at half of MFJ.
const MFS_BRACKETS = [
  { rate: 0.1, min: 0, max: 1_240_000 },
  { rate: 0.12, min: 1_240_000, max: 5_040_000 },
  { rate: 0.22, min: 5_040_000, max: 10_570_000 },
  { rate: 0.24, min: 10_570_000, max: 20_177_500 },
  { rate: 0.32, min: 20_177_500, max: 25_622_500 },
  { rate: 0.35, min: 25_622_500, max: 38_435_000 },
  { rate: 0.37, min: 38_435_000, max: null },
];

const MFJ_BRACKETS = [
  { rate: 0.1, min: 0, max: 2_480_000 },
  { rate: 0.12, min: 2_480_000, max: 10_080_000 },
  { rate: 0.22, min: 10_080_000, max: 21_140_000 },
  { rate: 0.24, min: 21_140_000, max: 40_355_000 },
  { rate: 0.32, min: 40_355_000, max: 51_245_000 },
  { rate: 0.35, min: 51_245_000, max: 76_870_000 },
  { rate: 0.37, min: 76_870_000, max: null },
];

const HOH_BRACKETS = [
  { rate: 0.1, min: 0, max: 1_770_000 },
  { rate: 0.12, min: 1_770_000, max: 6_745_000 },
  { rate: 0.22, min: 6_745_000, max: 10_570_000 },
  { rate: 0.24, min: 10_570_000, max: 20_177_500 },
  { rate: 0.32, min: 20_177_500, max: 25_620_000 },
  { rate: 0.35, min: 25_620_000, max: 64_060_000 },
  { rate: 0.37, min: 64_060_000, max: null },
];

// Shared 2026 payroll-tax constants.
const SOCIAL_SECURITY_RATE = 0.062;
const SOCIAL_SECURITY_WAGE_BASE_CENTS = 18_450_000; // $184,500
const MEDICARE_RATE = 0.0145;
const ADDITIONAL_MEDICARE_RATE = 0.009;
const TEXAS_STATE_RATE = 0; // Texas has no personal income tax.

function base(filingStatus, standardDeductionCents, brackets, addlMedicareThresholdCents) {
  return {
    year: 2026,
    filing_status: filingStatus,
    standard_deduction_cents: standardDeductionCents,
    federal_brackets: brackets,
    social_security_rate: SOCIAL_SECURITY_RATE,
    social_security_wage_base_cents: SOCIAL_SECURITY_WAGE_BASE_CENTS,
    medicare_rate: MEDICARE_RATE,
    additional_medicare_rate: ADDITIONAL_MEDICARE_RATE,
    additional_medicare_threshold_cents: addlMedicareThresholdCents,
    state_income_tax_rate: TEXAS_STATE_RATE,
  };
}

export const TAX_CONFIG_2026 = {
  single: base('single', 1_610_000, SINGLE_BRACKETS, 20_000_000),
  mfj: base('mfj', 3_220_000, MFJ_BRACKETS, 25_000_000),
  mfs: base('mfs', 1_610_000, MFS_BRACKETS, 12_500_000),
  hoh: base('hoh', 2_415_000, HOH_BRACKETS, 20_000_000),
};

export function getTaxConfig2026(filingStatus) {
  return TAX_CONFIG_2026[filingStatus] || TAX_CONFIG_2026.single;
}

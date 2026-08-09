// Shared enums, option lists, and display labels used across the app.
// Keeping these centralized avoids magic strings scattered through components
// and keeps them consistent with the database CHECK constraints.

/** Product name shown in the app shell, login screen, and document title. */
export const APP_NAME = 'YEROME Ledger';

export const FILING_STATUSES = ['single', 'mfj', 'mfs', 'hoh'];

export const FILING_STATUS_LABELS = {
  single: 'Single',
  mfj: 'Married Filing Jointly',
  mfs: 'Married Filing Separately',
  hoh: 'Head of Household',
};

export const OWNER_STATUSES = ['active', 'inactive', 'archived'];

export const OWNER_STATUS_LABELS = {
  active: 'Active',
  inactive: 'Inactive',
  archived: 'Archived',
};

export const JOB_STATUSES = ['pending', 'active', 'paused', 'ended', 'archived'];

export const JOB_STATUS_LABELS = {
  pending: 'Pending',
  active: 'Active',
  paused: 'Paused',
  ended: 'Ended',
  archived: 'Archived',
};

// Statuses that count toward "active" financial calculations.
export const ACTIVE_JOB_STATUSES = ['active'];

export const PAY_FREQUENCIES = ['weekly', 'biweekly', 'semimonthly', 'monthly'];

export const PAY_FREQUENCY_LABELS = {
  weekly: 'Weekly',
  biweekly: 'Biweekly',
  semimonthly: 'Semi-monthly',
  monthly: 'Monthly',
};

export const PAY_PERIODS_BY_FREQUENCY = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
};

export const COST_TYPES = ['per_job', 'fixed'];

export const COST_TYPE_LABELS = {
  per_job: 'Per-Job Cost',
  fixed: 'Fixed Cost',
};

export const COST_CADENCES = ['per_paycheck', 'monthly', 'annual', 'one_time'];

export const COST_CADENCE_LABELS = {
  per_paycheck: 'Per Paycheck',
  monthly: 'Monthly',
  annual: 'Annual',
  one_time: 'One-time',
};

export const ALLOCATION_METHODS = ['equal_owner', 'equal_all', 'manual', 'none'];

export const ALLOCATION_METHOD_LABELS = {
  equal_owner: "Split evenly across Owner's active jobs (recommended)",
  equal_all: 'Split evenly across all active jobs',
  manual: 'Manual allocation',
  none: 'Not allocated',
};

export const COMMISSION_BASIS_TYPES = [
  'referred_gross_wages',
  'referred_distributable',
  'selected_jobs',
  'flat_per_paycheck',
  'custom_manual',
];

export const COMMISSION_BASIS_LABELS = {
  referred_gross_wages: 'Percentage of referred Owner gross wages',
  referred_distributable: '% of referred net after tax & costs',
  selected_jobs: 'Percentage of selected jobs',
  flat_per_paycheck: 'Flat amount per paycheck',
  custom_manual: 'Custom manual amount (annual)',
};

export const JOB_PAYCHECK_STATUSES = ['scheduled', 'paid', 'skipped'];

export const JOB_PAYCHECK_STATUS_LABELS = {
  scheduled: 'Scheduled',
  paid: 'Paid',
  skipped: 'Skipped',
};

export const TRANSFER_AMOUNT_TYPES = ['fixed', 'percentage', 'calculated', 'informational'];

export const TRANSFER_AMOUNT_TYPE_LABELS = {
  fixed: 'Fixed amount',
  percentage: 'Percentage',
  calculated: 'Calculated amount',
  informational: 'Informational only',
};

// Deal structures (aligned with the YEROME spreadsheet partnerships).
export const DEAL_TYPES = ['miki_wohabe', 'three_way', 'no_middle'];

export const DEAL_TYPE_LABELS = {
  miki_wohabe: 'Miki & Wohabe · 2-Way',
  three_way: 'With Middle Man · 3-Way',
  no_middle: 'No Middle Man · 2-Way',
  two_way: 'No Middle Man · 2-Way', // legacy rows until migration 0009
};

export const DEAL_TYPE_HINTS = {
  miki_wohabe: 'Owner 50% / YEROME 50% of quoted net. Lower quoted cost package.',
  three_way: 'Owner 40% / Middle man 10% / YEROME 50% of quoted net.',
  no_middle: 'Owner 50% / YEROME 50% of quoted net. Higher quoted cost package.',
};

/** Default Owner share of quoted net by deal type. */
export const DEAL_OWNER_SHARE = {
  miki_wohabe: 0.5,
  three_way: 0.4,
  no_middle: 0.5,
  two_way: 0.5,
};

/** Client-facing middle-man share of quoted net. 0 on both 2-way deals. */
export const DEAL_MIDDLE_SHARE = {
  miki_wohabe: 0,
  three_way: 0.1,
  no_middle: 0,
  two_way: 0,
};

/** Paper YEROME share of quoted net. */
export const DEAL_YEROME_SHARE = {
  miki_wohabe: 0.5,
  three_way: 0.5,
  no_middle: 0.5,
  two_way: 0.5,
};

// Business-wide defaults.
export const DEFAULT_SAFETY_RESERVE_RATE = 0.12;
/** Haircut on after-tax before Gang Cut (sheet: 12%, then 10% of the rest). */
export const DEFAULT_GANG_RESERVE_RATE = 0.12;
export const DEFAULT_GANG_CUT_RATE = 0.1;
export const DEFAULT_COMMISSION_RATE = 0.1;
export const DEFAULT_DEAL_TYPE = 'three_way';
export const DEFAULT_PAY_PERIODS = 26;
export const DEFAULT_TAX_YEAR = 2026;
export const DEFAULT_STATE = 'TX';

export const TAX_DISCLAIMER =
  'Tax figures are planning estimates based on configured assumptions and are not tax advice, ' +
  'payroll calculations, or a tax return. Actual withholding and tax liability may differ.';

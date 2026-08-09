// Financial assembler: fetches the minimum data each view needs and runs it
// through the pure calculation engine (src/lib/calculations).

import { supabase } from '../supabase/client.js';
import {
  DEFAULT_TAX_YEAR,
  DEFAULT_SAFETY_RESERVE_RATE,
  DEFAULT_GANG_RESERVE_RATE,
  DEFAULT_GANG_CUT_RATE,
  ACTIVE_JOB_STATUSES,
} from '../constants.js';
import { costToAnnual, allocateFixedCost } from '../calculations/costs.js';
import { commissionAnnual } from '../calculations/commission.js';
import { computeOwnerFinancials, computePaycheckRecommendation } from '../calculations/summary.js';
import { getTaxSettings, getTaxSettingsMap } from './taxSettings.js';
import { getOwner, getMyOwner } from './owners.js';
import { listJobsForOwner, listMyJobs } from './jobs.js';
import { listMyVisibleCosts, listCostAllocations } from './costs.js';
import { getEarnedCommissions, getMyEarnedCommissions, listReferrals } from './commissions.js';
import { getBusinessSettings } from './businessSettings.js';

/**
 * Spread a fixed cost's annual amount onto jobs.
 * equal_owner / equal_all: live equal split so per-job (and paycheck) share
 * shrinks as the Owner's job count grows; Owner total still equals the full cost.
 * manual: uses stored allocation percentages.
 */
function applyFixedCostAnnual({
  out,
  cost,
  annualCents,
  jobIds,
  allJobs,
  ownerJobs,
  allocations,
}) {
  const idSet = new Set(jobIds);
  const method = cost.allocation_method || 'none';

  if (method === 'equal_owner') {
    const pool = ownerJobs || allJobs || [];
    const alloc = allocateFixedCost(annualCents, 'equal_owner', pool, { ownerId: cost.owner_id });
    for (const a of alloc) {
      if (idSet.has(a.jobId)) out[a.jobId] += a.cents;
    }
    return;
  }

  if (method === 'equal_all') {
    if (allJobs?.length) {
      const alloc = allocateFixedCost(annualCents, 'equal_all', allJobs);
      for (const a of alloc) {
        if (idSet.has(a.jobId)) out[a.jobId] += a.cents;
      }
      return;
    }
    // Owner portal may not see every job — fall back to materialized %.
    for (const a of allocations || []) {
      if (a.cost_id !== cost.id || !idSet.has(a.job_id)) continue;
      out[a.job_id] += Math.round((annualCents * Number(a.allocation_percentage)) / 100);
    }
    return;
  }

  if (method === 'manual') {
    for (const a of allocations || []) {
      if (a.cost_id !== cost.id || !idSet.has(a.job_id)) continue;
      out[a.job_id] += Math.round((annualCents * Number(a.allocation_percentage)) / 100);
    }
  }
}

/** Sum owner-quoted operating costs (annual cents) per job id. */
function quotedCostAnnualByJob({
  jobIds,
  perJobCosts,
  fixedCosts,
  allocations,
  allJobs = null,
  ownerJobs = null,
}) {
  const out = {};
  for (const id of jobIds) out[id] = 0;

  for (const c of perJobCosts) {
    if (!c.active || !c.owner_visible || c.cost_type !== 'per_job') continue;
    if (out[c.job_id] != null) out[c.job_id] += costToAnnual(c.quoted_amount_cents, c.cadence);
  }

  for (const cost of fixedCosts) {
    if (!cost.active || !cost.owner_visible || cost.cost_type !== 'fixed') continue;
    applyFixedCostAnnual({
      out,
      cost,
      annualCents: costToAnnual(cost.quoted_amount_cents, cost.cadence),
      jobIds,
      allJobs,
      ownerJobs,
      allocations,
    });
  }
  return out;
}

/**
 * Admin-only actual costs per job (annual cents).
 * Includes all costs on the job (owner-visible + Admin-only). Missing internal
 * details fall back to quoted so we don't invent margin.
 */
function actualCostAnnualByJob({
  jobIds,
  perJobCosts,
  fixedCosts,
  allocations,
  internalById,
  allJobs = null,
  ownerJobs = null,
}) {
  const out = {};
  for (const id of jobIds) out[id] = 0;
  const amountFor = (cost) => {
    const detail = internalById?.get(cost.id);
    if (detail && detail.actual_amount_cents != null) return Number(detail.actual_amount_cents) || 0;
    return Number(cost.quoted_amount_cents) || 0;
  };

  for (const c of perJobCosts) {
    if (!c.active || c.cost_type !== 'per_job') continue;
    if (out[c.job_id] != null) out[c.job_id] += costToAnnual(amountFor(c), c.cadence);
  }

  for (const cost of fixedCosts) {
    if (!cost.active || cost.cost_type !== 'fixed') continue;
    applyFixedCostAnnual({
      out,
      cost,
      annualCents: costToAnnual(amountFor(cost), cost.cadence),
      jobIds,
      allJobs,
      ownerJobs,
      allocations,
    });
  }
  return out;
}

function ownerBaseFromDatasets(owner, datasets, commissionOutAnnualCents = 0, commissionEarnedAnnualCents = 0, gangRates = {}) {
  const jobs = datasets.jobs.filter((j) => j.owner_id === owner.id);
  const jobIds = jobs.map((j) => j.id);
  const settings = datasets.settingsMap[owner.filing_status];
  const quotedByJob = quotedCostAnnualByJob({
    jobIds,
    perJobCosts: datasets.perJobCosts,
    fixedCosts: datasets.fixedCosts,
    allocations: datasets.allocations,
    allJobs: datasets.jobs,
    ownerJobs: jobs,
  });
  const actualByJob = actualCostAnnualByJob({
    jobIds,
    perJobCosts: datasets.perJobCosts,
    fixedCosts: datasets.fixedCosts,
    allocations: datasets.allocations,
    internalById: datasets.internalById,
    allJobs: datasets.jobs,
    ownerJobs: jobs,
  });
  const fin = computeOwnerFinancials({
    owner,
    jobs,
    settings,
    quotedCostAnnualByJob: quotedByJob,
    actualCostAnnualByJob: actualByJob,
    commissionOutAnnualCents,
    commissionEarnedAnnualCents,
    systemReserveDefault: DEFAULT_SAFETY_RESERVE_RATE,
    gangReserveRate: gangRates.gang_reserve_rate ?? datasets.gangRates?.gang_reserve_rate ?? DEFAULT_GANG_RESERVE_RATE,
    gangCutRate: gangRates.gang_cut_rate ?? datasets.gangRates?.gang_cut_rate ?? DEFAULT_GANG_CUT_RATE,
  });
  return { owner, jobs, settings, quotedByJob, actualByJob, fin };
}

function commissionEarnedForOwner(ownerId, datasets, baseByOwner) {
  const refs = datasets.referrals.filter((r) => r.active && r.referrer_owner_id === ownerId);
  let total = 0;
  for (const r of refs) {
    const referredBase = baseByOwner[r.referred_owner_id];
    const selected = (datasets.referralJobs || [])
      .filter((rj) => rj.referral_id === r.id)
      .map((rj) => datasets.jobs.find((j) => j.id === rj.job_id))
      .filter((j) => j && ACTIVE_JOB_STATUSES.includes(j.status))
      .reduce((s, j) => s + (j.projected_tax_year_wages_cents ?? j.annual_salary_cents ?? 0), 0);
    total += commissionAnnual(r, {
      referredGrossAnnualCents: referredBase?.fin.projectedAnnualWagesCents || 0,
      referredDistributableAnnualCents: referredBase?.fin.netProfitAnnualCents || 0,
      selectedJobsAnnualCents: selected,
    });
  }
  return total;
}

/** Commission paid OUT when this owner is the referred party. */
function commissionOutForOwner(ownerId, datasets, baseByOwner) {
  const refs = datasets.referrals.filter((r) => r.active && r.referred_owner_id === ownerId);
  let total = 0;
  const referredBase = baseByOwner[ownerId];
  for (const r of refs) {
    const selected = (datasets.referralJobs || [])
      .filter((rj) => rj.referral_id === r.id)
      .map((rj) => datasets.jobs.find((j) => j.id === rj.job_id))
      .filter((j) => j && ACTIVE_JOB_STATUSES.includes(j.status))
      .reduce((s, j) => s + (j.projected_tax_year_wages_cents ?? j.annual_salary_cents ?? 0), 0);
    total += commissionAnnual(r, {
      referredGrossAnnualCents: referredBase?.fin.projectedAnnualWagesCents || 0,
      referredDistributableAnnualCents: referredBase?.fin.netProfitAnnualCents || 0,
      selectedJobsAnnualCents: selected,
    });
  }
  return total;
}

function finalizeOwnerFinancials(
  owner,
  jobs,
  settings,
  quotedByJob,
  outboundReferrals,
  earnedRows,
  actualByJob = null,
  gangRates = {},
) {
  const commissionEarnedAnnualCents = (earnedRows || []).reduce(
    (s, e) => s + (Number(e.annual_commission_cents) || 0),
    0,
  );
  const base = computeOwnerFinancials({
    owner,
    jobs,
    settings,
    quotedCostAnnualByJob: quotedByJob,
    actualCostAnnualByJob: actualByJob,
    commissionOutAnnualCents: 0,
    commissionEarnedAnnualCents,
    systemReserveDefault: DEFAULT_SAFETY_RESERVE_RATE,
    gangReserveRate: gangRates.gang_reserve_rate ?? DEFAULT_GANG_RESERVE_RATE,
    gangCutRate: gangRates.gang_cut_rate ?? DEFAULT_GANG_CUT_RATE,
  });

  let commissionOutAnnualCents = 0;
  for (const r of outboundReferrals || []) {
    if (!r.active) continue;
    commissionOutAnnualCents += commissionAnnual(r, {
      referredGrossAnnualCents: base.projectedAnnualWagesCents,
      referredDistributableAnnualCents: base.netProfitAnnualCents,
    });
  }

  if (!commissionOutAnnualCents) {
    return base;
  }
  return computeOwnerFinancials({
    owner,
    jobs,
    settings,
    quotedCostAnnualByJob: quotedByJob,
    actualCostAnnualByJob: actualByJob,
    commissionOutAnnualCents,
    commissionEarnedAnnualCents,
    systemReserveDefault: DEFAULT_SAFETY_RESERVE_RATE,
    gangReserveRate: gangRates.gang_reserve_rate ?? DEFAULT_GANG_RESERVE_RATE,
    gangCutRate: gangRates.gang_cut_rate ?? DEFAULT_GANG_CUT_RATE,
  });
}

// ---------------------------------------------------------------------------
// Admin: single owner
// ---------------------------------------------------------------------------
export async function getOwnerFinancials(ownerId, year = DEFAULT_TAX_YEAR) {
  const owner = await getOwner(ownerId);
  if (!owner) throw new Error('Owner not found.');
  const [jobs, settings, earned, outboundReferrals, gangRates] = await Promise.all([
    listJobsForOwner(ownerId),
    getTaxSettings(owner.filing_status, year),
    getEarnedCommissions(ownerId, year),
    listReferrals({ referredId: ownerId }),
    getBusinessSettings(),
  ]);
  const jobIds = jobs.map((j) => j.id);

  const [perJobRes, allocRes, ownerFixedRes, equalAllRes, allActiveJobsRes] = await Promise.all([
    jobIds.length
      ? supabase.from('costs').select('*').eq('cost_type', 'per_job').in('job_id', jobIds)
      : Promise.resolve({ data: [] }),
    jobIds.length
      ? supabase.from('cost_allocations').select('*').in('job_id', jobIds)
      : Promise.resolve({ data: [] }),
    supabase
      .from('costs')
      .select('*')
      .eq('cost_type', 'fixed')
      .eq('active', true)
      .eq('owner_id', ownerId),
    supabase
      .from('costs')
      .select('*')
      .eq('cost_type', 'fixed')
      .eq('active', true)
      .eq('allocation_method', 'equal_all'),
    supabase.from('jobs').select('id, owner_id, status').eq('status', 'active'),
  ]);
  const perJobCosts = perJobRes.data || [];
  const allocations = allocRes.data || [];
  const fixedById = new Map();
  for (const c of [...(ownerFixedRes.data || []), ...(equalAllRes.data || [])]) fixedById.set(c.id, c);
  // Manual fixed costs that already have rows on this Owner's jobs.
  const manualIds = [...new Set(allocations.map((a) => a.cost_id))].filter((id) => !fixedById.has(id));
  if (manualIds.length) {
    const { data: manualFixed } = await supabase.from('costs').select('*').in('id', manualIds);
    for (const c of manualFixed || []) fixedById.set(c.id, c);
  }
  const fixedCosts = [...fixedById.values()];
  const allCostIds = [...new Set([...perJobCosts.map((c) => c.id), ...fixedCosts.map((c) => c.id)])];
  const internalRes = allCostIds.length
    ? await supabase.from('cost_internal_details').select('*').in('cost_id', allCostIds)
    : { data: [] };
  const internalById = new Map((internalRes.data || []).map((d) => [d.cost_id, d]));
  const allJobs = allActiveJobsRes.data || [];
  const quotedByJob = quotedCostAnnualByJob({
    jobIds,
    perJobCosts,
    fixedCosts,
    allocations,
    allJobs,
    ownerJobs: jobs,
  });
  const actualByJob = actualCostAnnualByJob({
    jobIds,
    perJobCosts,
    fixedCosts,
    allocations,
    internalById,
    allJobs,
    ownerJobs: jobs,
  });

  const fin = finalizeOwnerFinancials(
    owner,
    jobs,
    settings,
    quotedByJob,
    outboundReferrals,
    earned,
    actualByJob,
    gangRates,
  );
  return { owner, jobs, settings, financials: fin, earnedCommissions: earned || [] };
}

// ---------------------------------------------------------------------------
// Owner portal: my financials
// ---------------------------------------------------------------------------
export async function getMyOwnerFinancials(year = DEFAULT_TAX_YEAR) {
  const owner = await getMyOwner();
  if (!owner) throw new Error('No Owner profile is linked to this account.');
  const [jobs, settings, visibleCosts, allocations, earned, outboundReferrals, gangRates] = await Promise.all([
    listMyJobs(),
    getTaxSettings(owner.filing_status, year),
    listMyVisibleCosts(),
    listCostAllocations(),
    getMyEarnedCommissions(year),
    listReferrals({ referredId: owner.id }),
    getBusinessSettings(),
  ]);
  const jobIds = jobs.map((j) => j.id);
  const perJobCosts = visibleCosts.filter((c) => c.cost_type === 'per_job');
  const fixedCosts = visibleCosts.filter((c) => c.cost_type === 'fixed');
  // equal_owner splits live from this Owner's jobs; equal_all uses allocation %.
  const quotedByJob = quotedCostAnnualByJob({
    jobIds,
    perJobCosts,
    fixedCosts,
    allocations,
    allJobs: null,
    ownerJobs: jobs,
  });
  const fin = finalizeOwnerFinancials(owner, jobs, settings, quotedByJob, outboundReferrals, earned, null, gangRates);
  return { owner, jobs, settings, financials: fin, earnedCommissions: earned || [] };
}

// ---------------------------------------------------------------------------
// Admin: whole-business overview
// ---------------------------------------------------------------------------
export async function getBusinessOverview(year = DEFAULT_TAX_YEAR) {
  const [ownersRes, jobsRes, settingsMap, costsRes, allocRes, referralsRes, referralJobsRes, internalRes, gangRates] =
    await Promise.all([
      supabase.from('owners').select('*').order('display_name'),
      supabase.from('jobs').select('*'),
      getTaxSettingsMap(year),
      supabase.from('costs').select('*').eq('active', true),
      supabase.from('cost_allocations').select('*'),
      supabase.from('referrals').select('*'),
      supabase.from('referral_jobs').select('*'),
      supabase.from('cost_internal_details').select('*'),
      getBusinessSettings(),
    ]);

  for (const r of [ownersRes, jobsRes, costsRes, allocRes, referralsRes, referralJobsRes, internalRes]) {
    if (r.error) throw r.error;
  }

  const owners = ownersRes.data || [];
  const allJobs = jobsRes.data || [];
  const costs = costsRes.data || [];
  const internalById = new Map((internalRes.data || []).map((d) => [d.cost_id, d]));
  const datasets = {
    jobs: allJobs,
    settingsMap,
    perJobCosts: costs.filter((c) => c.cost_type === 'per_job'),
    fixedCosts: costs.filter((c) => c.cost_type === 'fixed'),
    allocations: allocRes.data || [],
    referrals: referralsRes.data || [],
    referralJobs: referralJobsRes.data || [],
    internalById,
    gangRates,
  };

  // Pass 1: base (no commission out) to establish net profit.
  const baseByOwner = {};
  for (const owner of owners) baseByOwner[owner.id] = ownerBaseFromDatasets(owner, datasets, 0, 0);

  // Pass 2: apply commission out + earned, recompute splits.
  const ownerSummaries = owners.map((owner) => {
    const commissionOut = commissionOutForOwner(owner.id, datasets, baseByOwner);
    const commissionEarned = commissionEarnedForOwner(owner.id, datasets, baseByOwner);
    const finalized = ownerBaseFromDatasets(owner, datasets, commissionOut, commissionEarned);
    const fin = finalized.fin;
    return {
      owner,
      activeJobCount: fin.activeJobCount,
      projectedAnnualWagesCents: fin.projectedAnnualWagesCents,
      totalTaxCents: fin.ownerTax.totalTaxCents,
      afterTaxAnnualCents: fin.afterTaxAnnualCents,
      quotedCostsAnnualCents: fin.quotedCostsAnnualCents,
      actualCostsAnnualCents: fin.actualCostsAnnualCents,
      costMarginAnnualCents: fin.costMarginAnnualCents,
      netProfitAnnualCents: fin.netProfitAnnualCents,
      ownerCutAnnualCents: fin.ownerCutAnnualCents,
      commissionOutAnnualCents: fin.commissionOutAnnualCents,
      opsDealShareAnnualCents: fin.opsDealShareAnnualCents,
      gangCutAnnualCents: fin.gangCutAnnualCents,
      opsCutAnnualCents: fin.opsCutAnnualCents,
      commissionEarnedAnnualCents: commissionEarned,
      reserveAnnualCents: fin.reserveAnnualCents,
      estimatedRemainingAnnualCents: fin.ownerCutAnnualCents,
    };
  });

  const activeOwners = owners.filter((o) => o.status === 'active').length;
  const activeJobs = allJobs.filter((j) => ACTIVE_JOB_STATUSES.includes(j.status));
  const annualGrossCents = ownerSummaries.reduce((s, o) => s + o.projectedAnnualWagesCents, 0);
  const totalTaxCents = ownerSummaries.reduce((s, o) => s + o.totalTaxCents, 0);
  const totalNetCents = ownerSummaries.reduce((s, o) => s + o.netProfitAnnualCents, 0);
  const totalOpsCutCents = ownerSummaries.reduce((s, o) => s + o.opsCutAnnualCents, 0);
  const totalOwnerCutCents = ownerSummaries.reduce((s, o) => s + o.ownerCutAnnualCents, 0);
  const totalCommissionCents = ownerSummaries.reduce((s, o) => s + o.commissionEarnedAnnualCents, 0);

  let totalActualCostsCents = 0;
  let totalQuotedCostDefsCents = 0;
  for (const c of costs) {
    totalQuotedCostDefsCents += costToAnnual(c.quoted_amount_cents, c.cadence);
    const detail = internalById.get(c.id);
    if (detail) totalActualCostsCents += costToAnnual(detail.actual_amount_cents, c.cadence);
  }

  const recentJobs = [...allJobs]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5);

  return {
    ownerSummaries,
    totals: {
      activeOwners,
      totalOwners: owners.length,
      activeJobCount: activeJobs.length,
      annualGrossCents,
      monthlyGrossCents: Math.round(annualGrossCents / 12),
      totalTaxCents,
      totalNetCents,
      totalOpsCutCents,
      totalOwnerCutCents,
      totalQuotedCostDefsCents,
      totalActualCostsCents,
      marginCents: totalQuotedCostDefsCents - totalActualCostsCents,
      totalCommissionCents,
    },
    recentJobs,
    owners,
  };
}

// ---------------------------------------------------------------------------
// Admin: paycheck planner
// ---------------------------------------------------------------------------
export async function getPaycheckPlanner(year = DEFAULT_TAX_YEAR) {
  const overview = await getBusinessOverview(year);
  // Rebuild detailed breakdowns with the same dataset path as overview.
  const [ownersRes, jobsRes, settingsMap, costsRes, allocRes, referralsRes, referralJobsRes, tiRes, gangRates] =
    await Promise.all([
      supabase.from('owners').select('*').order('display_name'),
      supabase.from('jobs').select('*'),
      getTaxSettingsMap(year),
      supabase.from('costs').select('*').eq('active', true),
      supabase.from('cost_allocations').select('*'),
      supabase.from('referrals').select('*'),
      supabase.from('referral_jobs').select('*'),
      supabase.from('transfer_instructions').select('*').eq('active', true).order('sort_order'),
      getBusinessSettings(),
    ]);
  for (const r of [ownersRes, jobsRes, costsRes, allocRes, referralsRes, referralJobsRes, tiRes]) {
    if (r.error) throw r.error;
  }

  const owners = ownersRes.data || [];
  const allJobs = jobsRes.data || [];
  const costs = costsRes.data || [];
  const internalRes = await supabase.from('cost_internal_details').select('*');
  if (internalRes.error) throw internalRes.error;
  const datasets = {
    jobs: allJobs,
    settingsMap,
    perJobCosts: costs.filter((c) => c.cost_type === 'per_job'),
    fixedCosts: costs.filter((c) => c.cost_type === 'fixed'),
    allocations: allocRes.data || [],
    referrals: referralsRes.data || [],
    referralJobs: referralJobsRes.data || [],
    internalById: new Map((internalRes.data || []).map((d) => [d.cost_id, d])),
    gangRates,
  };
  const instructions = tiRes.data || [];

  const baseByOwner = {};
  for (const owner of owners) baseByOwner[owner.id] = ownerBaseFromDatasets(owner, datasets, 0, 0);

  const rows = [];
  const breakdownByJobId = {};
  for (const owner of owners) {
    const commissionOut = commissionOutForOwner(owner.id, datasets, baseByOwner);
    const commissionEarned = commissionEarnedForOwner(owner.id, datasets, baseByOwner);
    const finalized = ownerBaseFromDatasets(owner, datasets, commissionOut, commissionEarned);
    const ownerActiveWages = finalized.fin.projectedAnnualWagesCents || 0;

    for (const breakdown of finalized.fin.jobBreakdowns) {
      breakdownByJobId[breakdown.job.id] = breakdown;
      const rec = computePaycheckRecommendation(breakdown);
      const wageRatio = ownerActiveWages > 0 ? breakdown.wagesAnnualCents / ownerActiveWages : 0;
      const commissionInPerPeriod = Math.round(
        (commissionEarned * wageRatio) / (breakdown.payPeriods || 26),
      );
      const jobInstructions = instructions.filter(
        (i) => i.owner_id === owner.id && i.job_id === breakdown.job.id,
      );
      const ownerLevel = instructions.filter((i) => i.owner_id === owner.id && i.job_id == null);
      rows.push({
        job: breakdown.job,
        owner,
        recommendation: rec,
        commissionInPerPeriodCents: commissionInPerPeriod,
        instructions: jobInstructions.length ? jobInstructions : ownerLevel,
      });
    }
  }

  return {
    rows,
    breakdownByJobId,
    ownerById: new Map(owners.map((o) => [o.id, o])),
    overview,
  };
}

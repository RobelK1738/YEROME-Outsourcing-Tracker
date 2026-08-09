// Cost data access.
//
// PRIVACY: `costs` holds Owner-visible quoted amounts. `cost_internal_details`
// holds Admin-only ACTUAL amounts and is in a separate, Admin-only table (RLS).
// Owner-quoted reads never touch cost_internal_details.
//
// Fixed-cost splits are materialized into `cost_allocations` (percent per job)
// so both the JS engine and the SQL helpers read one consistent source.

import { supabase } from '../supabase/client.js';
import { logAudit } from './audit.js';
import { costFromTemplate } from '../costTemplates.js';

/** Admin: list costs with their internal (actual) details attached. */
export async function listCosts({ type = 'all', ownerId = null, jobId = null, active = 'all' } = {}) {
  let query = supabase
    .from('costs')
    .select('*, job:jobs(id, employer_name, owner_id), owner:owners(id, display_name)')
    .order('created_at', { ascending: false });
  if (type && type !== 'all') query = query.eq('cost_type', type);
  if (ownerId) query = query.eq('owner_id', ownerId);
  if (jobId) query = query.eq('job_id', jobId);
  if (active === true || active === false) query = query.eq('active', active);
  const { data, error } = await query;
  if (error) throw error;
  const costs = data || [];
  const details = await getInternalDetailsMap(costs.map((c) => c.id));
  return costs.map((c) => ({ ...c, internal: details[c.id] || null }));
}

/** Admin: map of costId -> internal detail row. */
export async function getInternalDetailsMap(costIds = []) {
  if (!costIds.length) return {};
  const { data, error } = await supabase
    .from('cost_internal_details')
    .select('*')
    .in('cost_id', costIds);
  if (error) throw error;
  const map = {};
  for (const row of data || []) map[row.cost_id] = row;
  return map;
}

/** Owner portal: quoted costs the current Owner is allowed to see (RLS). */
export async function listMyVisibleCosts() {
  const { data, error } = await supabase
    .from('costs')
    .select('*')
    .eq('active', true)
    .eq('owner_visible', true)
    .order('name');
  if (error) throw error;
  return data || [];
}

/** cost_allocations rows the caller can see (Admin: all; Owner: own jobs). */
export async function listCostAllocations({ costId = null } = {}) {
  let query = supabase.from('cost_allocations').select('*');
  if (costId) query = query.eq('cost_id', costId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * Create a cost from a template row, scoped to an Owner (fixed) or job (per-job).
 * Skips create if an active cost with the same name already exists on that scope.
 *
 * The template's amounts are COPIED onto the cost, so later edits to the
 * template never rewrite costs that are already assigned.
 */
export async function createCostFromTemplate(template, { ownerId = null, jobId = null, dealType = null } = {}) {
  const { cost: costRow, internal } = costFromTemplate(template, { ownerId, jobId, dealType });

  // Avoid duplicates on the same Owner / job.
  let existingQuery = supabase
    .from('costs')
    .select('id')
    .eq('name', template.name)
    .eq('active', true)
    .limit(1);
  if (template.cost_type === 'fixed') existingQuery = existingQuery.eq('owner_id', ownerId);
  else existingQuery = existingQuery.eq('job_id', jobId);
  const { data: existingRows, error: exErr } = await existingQuery;
  if (exErr) throw exErr;
  const existing = (existingRows || [])[0];
  if (existing) return { created: false, skipped: true, cost: existing, template };

  const cost = await createCost(costRow, internal);
  return { created: true, skipped: false, cost, template };
}

/** Apply several template rows; returns created / skipped counts. */
export async function applyCostTemplates(templates = [], scope = {}) {
  const results = [];
  for (const template of templates) {
    results.push(await createCostFromTemplate(template, scope));
  }
  return {
    results,
    createdCount: results.filter((r) => r.created).length,
    skippedCount: results.filter((r) => r.skipped).length,
  };
}

/**
 * Create a cost. When internal.actual_amount_cents is provided, an Admin-only
 * cost_internal_details row is created. Fixed costs trigger allocation refresh.
 */
export async function createCost(cost, internal = null) {
  const { data, error } = await supabase.from('costs').insert(cost).select().single();
  if (error) throw error;
  if (internal && (internal.actual_amount_cents != null || internal.internal_notes)) {
    const { error: dErr } = await supabase.from('cost_internal_details').insert({
      cost_id: data.id,
      actual_amount_cents: internal.actual_amount_cents ?? 0,
      internal_notes: internal.internal_notes ?? null,
    });
    if (dErr) throw dErr;
  }
  await logAudit({
    action: 'cost.created',
    entityType: 'cost',
    entityId: data.id,
    metadata: { name: data.name, cost_type: data.cost_type, quoted_amount_cents: data.quoted_amount_cents },
  });
  if (data.cost_type === 'fixed') await recomputeAllFixedAllocations();
  return data;
}

export async function updateCost(id, patch, internalPatch = null) {
  const { data, error } = await supabase.from('costs').update(patch).eq('id', id).select().single();
  if (error) throw error;
  if (internalPatch) {
    await upsertInternalDetail(id, internalPatch);
  }
  await logAudit({
    action: 'cost.changed',
    entityType: 'cost',
    entityId: id,
    metadata: { name: data.name, quoted_amount_cents: data.quoted_amount_cents },
  });
  if (data.cost_type === 'fixed') await recomputeAllFixedAllocations();
  return data;
}

/** Upsert the Admin-only actual amount + internal notes for a cost. */
export async function upsertInternalDetail(costId, { actual_amount_cents, internal_notes }) {
  const payload = { cost_id: costId };
  if (actual_amount_cents != null) payload.actual_amount_cents = actual_amount_cents;
  if (internal_notes !== undefined) payload.internal_notes = internal_notes;
  const { error } = await supabase.from('cost_internal_details').upsert(payload);
  if (error) throw error;
}

export async function archiveCost(id) {
  const { data, error } = await supabase
    .from('costs')
    .update({ active: false })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  await logAudit({ action: 'cost.changed', entityType: 'cost', entityId: id, metadata: { archived: true } });
  if (data.cost_type === 'fixed') await recomputeAllFixedAllocations();
  return data;
}

/** Permanently delete a cost (cascades internal details + allocations). */
export async function deleteCost(id) {
  const { data: before } = await supabase.from('costs').select('*').eq('id', id).maybeSingle();
  const { error } = await supabase.from('costs').delete().eq('id', id);
  if (error) throw error;
  await logAudit({
    action: 'cost.deleted',
    entityType: 'cost',
    entityId: id,
    metadata: { name: before?.name, cost_type: before?.cost_type },
  });
  if (before?.cost_type === 'fixed') await recomputeAllFixedAllocations();
}

/** Replace manual allocation rows for a fixed cost (percent per job). */
export async function setManualAllocations(costId, allocations = []) {
  await supabase.from('cost_allocations').delete().eq('cost_id', costId);
  if (allocations.length) {
    const rows = allocations.map((a) => ({
      cost_id: costId,
      job_id: a.job_id,
      allocation_percentage: Number(a.allocation_percentage) || 0,
    }));
    const { error } = await supabase.from('cost_allocations').insert(rows);
    if (error) throw error;
  }
}

/**
 * Recompute cost_allocations for equal_all / equal_owner fixed costs so an
 * Owner can read their share directly. Manual allocations are left untouched.
 */
export async function recomputeAllFixedAllocations() {
  const { data: fixedCosts, error } = await supabase
    .from('costs')
    .select('id, owner_id, allocation_method, cost_type, active')
    .eq('cost_type', 'fixed')
    .eq('active', true)
    .in('allocation_method', ['equal_all', 'equal_owner']);
  if (error) throw error;
  if (!fixedCosts?.length) return;

  const { data: activeJobs, error: jErr } = await supabase
    .from('jobs')
    .select('id, owner_id')
    .eq('status', 'active');
  if (jErr) throw jErr;
  const jobs = activeJobs || [];

  for (const cost of fixedCosts) {
    const targets =
      cost.allocation_method === 'equal_owner'
        ? jobs.filter((j) => j.owner_id === cost.owner_id)
        : jobs;
    await supabase.from('cost_allocations').delete().eq('cost_id', cost.id);
    if (!targets.length) continue;
    // Equal split: as job count grows, each job's % (and paycheck share) shrinks;
    // percentages still sum to 100 so Owner total stays the full fixed cost.
    let allocatedPct = 0;
    const rows = targets.map((j, i) => {
      let pct;
      if (i === targets.length - 1) {
        pct = Number((100 - allocatedPct).toFixed(4));
      } else {
        pct = Number((100 / targets.length).toFixed(4));
        allocatedPct += pct;
      }
      return { cost_id: cost.id, job_id: j.id, allocation_percentage: pct };
    });
    const { error: iErr } = await supabase.from('cost_allocations').insert(rows);
    if (iErr) throw iErr;
  }
}

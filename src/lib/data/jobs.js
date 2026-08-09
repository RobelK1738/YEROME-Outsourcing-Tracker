// Job data access + audit logging for meaningful changes.

import { supabase } from '../supabase/client.js';
import { logAudit } from './audit.js';
import { recomputeAllFixedAllocations } from './costs.js';

/** List jobs, optionally filtered by owner / employer text / status. */
export async function listJobs({ ownerId = null, search = '', status = 'all' } = {}) {
  let query = supabase
    .from('jobs')
    .select('*, owner:owners(id, display_name, username, filing_status, safety_reserve_rate, status)')
    .order('created_at', { ascending: false });
  if (ownerId) query = query.eq('owner_id', ownerId);
  if (status && status !== 'all') query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw error;
  let rows = data || [];
  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter(
      (j) =>
        j.employer_name?.toLowerCase().includes(q) || j.role_title?.toLowerCase().includes(q),
    );
  }
  return rows;
}

/** Jobs for a single owner (all statuses) — used by calculations. */
export async function listJobsForOwner(ownerId) {
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** All jobs the current Owner can see (RLS scopes to their own). */
export async function listMyJobs() {
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getJob(id) {
  const { data, error } = await supabase
    .from('jobs')
    .select('*, owner:owners(id, display_name, username, filing_status, safety_reserve_rate, status)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createJob(job) {
  const { data, error } = await supabase.from('jobs').insert(job).select().single();
  if (error) throw error;
  await logAudit({
    action: 'job.created',
    entityType: 'job',
    entityId: data.id,
    metadata: {
      owner_id: data.owner_id,
      employer_name: data.employer_name,
      annual_salary_cents: data.annual_salary_cents,
      status: data.status,
    },
  });
  // A new active job affects equal-allocation fixed costs.
  await recomputeAllFixedAllocations();
  return data;
}

export async function updateJob(id, patch) {
  const before = await getJob(id);
  const { data, error } = await supabase.from('jobs').update(patch).eq('id', id).select().single();
  if (error) throw error;

  if ('annual_salary_cents' in patch && before?.annual_salary_cents !== data.annual_salary_cents) {
    await logAudit({
      action: 'job.salary_changed',
      entityType: 'job',
      entityId: id,
      metadata: { from: before?.annual_salary_cents, to: data.annual_salary_cents },
    });
  }
  if ('status' in patch && before?.status !== data.status) {
    const action = ['ended', 'archived'].includes(data.status) ? 'job.ended' : 'job.status_changed';
    await logAudit({
      action,
      entityType: 'job',
      entityId: id,
      metadata: { from: before?.status, to: data.status },
    });
  }
  await logAudit({ action: 'job.updated', entityType: 'job', entityId: id });

  // Status changes can add/remove a job from the active set.
  if ('status' in patch && before?.status !== data.status) {
    await recomputeAllFixedAllocations();
  }
  return data;
}

/** Convenience for the common "end this job" action. */
export async function endJob(id, endDate) {
  return updateJob(id, { status: 'ended', end_date: endDate || new Date().toISOString().slice(0, 10) });
}

/** Permanently delete a job (cascades paychecks, allocations, job-scoped costs). */
export async function deleteJob(id) {
  const before = await getJob(id);
  const { error } = await supabase.from('jobs').delete().eq('id', id);
  if (error) throw error;
  await logAudit({
    action: 'job.deleted',
    entityType: 'job',
    entityId: id,
    metadata: {
      owner_id: before?.owner_id,
      employer_name: before?.employer_name,
    },
  });
  await recomputeAllFixedAllocations();
}

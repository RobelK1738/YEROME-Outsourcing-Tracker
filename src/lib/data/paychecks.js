// Per-job paycheck schedule data access. The Admin sets the dates each job's
// paychecks arrive; Owners get read-only access to their own jobs' schedule
// (enforced by RLS). Per-paycheck cuts/taxes are computed from the calculation
// engine at render time — this layer stores timing + optional overrides.

import { supabase } from '../supabase/client.js';
import { logAudit } from './audit.js';
import { generatePayDates } from '../formatting/dates.js';

/** Admin/Owner: all scheduled paychecks for a job (RLS scopes Owners). */
export async function listJobPaychecks(jobId) {
  const { data, error } = await supabase
    .from('job_paychecks')
    .select('*')
    .eq('job_id', jobId)
    .order('pay_date', { ascending: true });
  if (error) throw error;
  return data || [];
}

/**
 * Upcoming scheduled paychecks (optionally from a date), with job info joined.
 * Admin sees all; an Owner sees only their own jobs (RLS).
 */
export async function listUpcomingPaychecks({ from = null, limit = 200 } = {}) {
  let query = supabase
    .from('job_paychecks')
    .select(
      '*, job:jobs(id, employer_name, owner_id, annual_salary_cents, projected_tax_year_wages_cents, pay_periods_per_year, safety_reserve_rate, status)',
    )
    .order('pay_date', { ascending: true })
    .limit(limit);
  if (from) query = query.gte('pay_date', from);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function createJobPaycheck(row) {
  const { data, error } = await supabase.from('job_paychecks').insert(row).select().single();
  if (error) throw error;
  await logAudit({
    action: 'paycheck.scheduled',
    entityType: 'job_paycheck',
    entityId: data.id,
    metadata: { job_id: data.job_id, pay_date: data.pay_date },
  });
  return data;
}

export async function updateJobPaycheck(id, patch) {
  const { data, error } = await supabase
    .from('job_paychecks')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  await logAudit({
    action: 'paycheck.updated',
    entityType: 'job_paycheck',
    entityId: id,
    metadata: { pay_date: data.pay_date, status: data.status },
  });
  return data;
}

export async function deleteJobPaycheck(id) {
  const { error } = await supabase.from('job_paychecks').delete().eq('id', id);
  if (error) throw error;
  await logAudit({ action: 'paycheck.removed', entityType: 'job_paycheck', entityId: id });
}

/**
 * Generate a schedule of pay dates for a job. Creates rows for any dates that
 * don't already exist (existing dates are left untouched). Uses the job's pay
 * frequency to space the dates.
 *
 * @returns the number of new paychecks created.
 */
export async function generateSchedule(job, { startDate, count }) {
  const dates = generatePayDates(startDate, Number(count) || 0, job.pay_frequency);
  if (!dates.length) return 0;

  const existing = await listJobPaychecks(job.id);
  const existingDates = new Set(existing.map((p) => p.pay_date));
  const rows = dates
    .filter((d) => !existingDates.has(d))
    .map((pay_date) => ({ job_id: job.id, pay_date, status: 'scheduled' }));

  if (!rows.length) return 0;
  const { error } = await supabase.from('job_paychecks').insert(rows);
  if (error) throw error;
  await logAudit({
    action: 'paycheck.schedule_generated',
    entityType: 'job',
    entityId: job.id,
    metadata: { created: rows.length, start_date: startDate, count: dates.length },
  });
  return rows.length;
}

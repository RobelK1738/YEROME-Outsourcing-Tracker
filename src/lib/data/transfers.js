// Transfer instruction data access (Owner-level defaults + Job-level overrides).

import { supabase } from '../supabase/client.js';
import { logAudit } from './audit.js';

/** Admin: instructions for an owner (and optionally a specific job). */
export async function listTransferInstructions({ ownerId, jobId = undefined } = {}) {
  let query = supabase
    .from('transfer_instructions')
    .select('*')
    .order('sort_order', { ascending: true });
  if (ownerId) query = query.eq('owner_id', ownerId);
  if (jobId !== undefined) {
    query = jobId === null ? query.is('job_id', null) : query.eq('job_id', jobId);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/** Owner portal: the current Owner's active instructions (RLS scoped). */
export async function listMyTransferInstructions() {
  const { data, error } = await supabase
    .from('transfer_instructions')
    .select('*')
    .eq('active', true)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return data || [];
}

/**
 * Resolve the effective instructions for a job: job-level overrides replace
 * owner-level defaults when the job has any of its own instructions.
 */
export function resolveInstructionsForJob(allInstructions, jobId) {
  const jobLevel = allInstructions.filter((i) => i.job_id === jobId);
  if (jobLevel.length) return jobLevel;
  return allInstructions.filter((i) => i.job_id == null);
}

export async function createTransferInstruction(instruction) {
  const { data, error } = await supabase
    .from('transfer_instructions')
    .insert(instruction)
    .select()
    .single();
  if (error) throw error;
  await logAudit({
    action: 'transfer_instruction.changed',
    entityType: 'transfer_instruction',
    entityId: data.id,
    metadata: { owner_id: data.owner_id, job_id: data.job_id, label: data.label },
  });
  return data;
}

export async function updateTransferInstruction(id, patch) {
  const { data, error } = await supabase
    .from('transfer_instructions')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  await logAudit({
    action: 'transfer_instruction.changed',
    entityType: 'transfer_instruction',
    entityId: id,
    metadata: { label: data.label },
  });
  return data;
}

export async function deleteTransferInstruction(id) {
  // Instructions are configuration, not financial history, so a hard delete is
  // acceptable here. We soft-disable instead to keep behavior consistent.
  const { data, error } = await supabase
    .from('transfer_instructions')
    .update({ active: false })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  await logAudit({
    action: 'transfer_instruction.changed',
    entityType: 'transfer_instruction',
    entityId: id,
    metadata: { disabled: true },
  });
  return data;
}

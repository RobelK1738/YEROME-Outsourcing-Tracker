// Referral / commission data access. Commission AMOUNTS are computed by the
// SECURITY DEFINER RPC owner_earned_commissions so an Owner can see what they
// earn without the client reading the referred Owner's protected data.

import { supabase } from '../supabase/client.js';
import { logAudit } from './audit.js';
import { DEFAULT_TAX_YEAR } from '../constants.js';

/** Admin: list referral relationships with both owners' names. */
export async function listReferrals({ referrerId = null, referredId = null, active = 'all' } = {}) {
  let query = supabase
    .from('referrals')
    .select(
      '*, referrer:owners!referrals_referrer_owner_id_fkey(id, display_name), referred:owners!referrals_referred_owner_id_fkey(id, display_name)',
    )
    .order('created_at', { ascending: false });
  if (referrerId) query = query.eq('referrer_owner_id', referrerId);
  if (referredId) query = query.eq('referred_owner_id', referredId);
  if (active === true || active === false) query = query.eq('active', active);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getReferral(id) {
  const { data, error } = await supabase.from('referrals').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listReferralJobs(referralId) {
  const { data, error } = await supabase
    .from('referral_jobs')
    .select('job_id')
    .eq('referral_id', referralId);
  if (error) throw error;
  return (data || []).map((r) => r.job_id);
}

export async function createReferral(referral, selectedJobIds = []) {
  const { data, error } = await supabase.from('referrals').insert(referral).select().single();
  if (error) throw error;
  if (referral.commission_basis_type === 'selected_jobs' && selectedJobIds.length) {
    await setReferralJobs(data.id, selectedJobIds);
  }
  await logAudit({
    action: 'commission.created',
    entityType: 'referral',
    entityId: data.id,
    metadata: {
      referrer_owner_id: data.referrer_owner_id,
      referred_owner_id: data.referred_owner_id,
      commission_rate: data.commission_rate,
      commission_basis_type: data.commission_basis_type,
    },
  });
  return data;
}

export async function updateReferral(id, patch, selectedJobIds = null) {
  const { data, error } = await supabase.from('referrals').update(patch).eq('id', id).select().single();
  if (error) throw error;
  if (selectedJobIds != null) await setReferralJobs(id, selectedJobIds);
  await logAudit({
    action: 'commission.changed',
    entityType: 'referral',
    entityId: id,
    metadata: { commission_rate: data.commission_rate, commission_basis_type: data.commission_basis_type },
  });
  return data;
}

export async function archiveReferral(id) {
  const { data, error } = await supabase
    .from('referrals')
    .update({ active: false })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  await logAudit({ action: 'commission.changed', entityType: 'referral', entityId: id, metadata: { archived: true } });
  return data;
}

async function setReferralJobs(referralId, jobIds) {
  await supabase.from('referral_jobs').delete().eq('referral_id', referralId);
  if (jobIds.length) {
    const rows = jobIds.map((job_id) => ({ referral_id: referralId, job_id }));
    const { error } = await supabase.from('referral_jobs').insert(rows);
    if (error) throw error;
  }
}

/** Computed earned commissions for an Owner (Admin may pass any ownerId). */
export async function getEarnedCommissions(ownerId, year = DEFAULT_TAX_YEAR) {
  const { data, error } = await supabase.rpc('owner_earned_commissions', {
    p_owner: ownerId,
    p_year: year,
  });
  if (error) throw error;
  return data || [];
}

/** Computed earned commissions for the currently signed-in Owner. */
export async function getMyEarnedCommissions(year = DEFAULT_TAX_YEAR) {
  const { data, error } = await supabase.rpc('owner_earned_commissions', { p_year: year });
  if (error) throw error;
  return data || [];
}

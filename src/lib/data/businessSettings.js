// Singleton business settings (Gang Cut rates). YEROME-only via RLS.
// Falls back to sheet defaults if the row isn't there yet (pre-migration).

import { supabase } from '../supabase/client.js';
import { DEFAULT_GANG_CUT_RATE, DEFAULT_GANG_RESERVE_RATE } from '../constants.js';
import { logAudit } from './audit.js';

const FALLBACK = {
  id: 1,
  gang_reserve_rate: DEFAULT_GANG_RESERVE_RATE,
  gang_cut_rate: DEFAULT_GANG_CUT_RATE,
};

export async function getBusinessSettings() {
  const { data, error } = await supabase.from('business_settings').select('*').eq('id', 1).maybeSingle();
  if (error || !data) return { ...FALLBACK };
  return {
    ...FALLBACK,
    ...data,
    gang_reserve_rate: Number(data.gang_reserve_rate) || DEFAULT_GANG_RESERVE_RATE,
    gang_cut_rate: Number(data.gang_cut_rate) || DEFAULT_GANG_CUT_RATE,
  };
}

export async function updateBusinessSettings(patch) {
  const current = await getBusinessSettings();
  const next = {
    id: 1,
    gang_reserve_rate: patch.gang_reserve_rate ?? current.gang_reserve_rate,
    gang_cut_rate: patch.gang_cut_rate ?? current.gang_cut_rate,
  };
  const { data, error } = await supabase
    .from('business_settings')
    .upsert(next, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw error;
  await logAudit({
    action: 'business_settings.changed',
    entityType: 'business_settings',
    entityId: '1',
    metadata: { fields: Object.keys(patch || {}) },
  });
  return data;
}

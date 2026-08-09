// Owner data access. Owner creation, password reset, and status changes that
// require the Supabase service role go through the trusted API routes (see
// adminApi.js). Plain field edits use the Admin's RLS-protected session.

import { supabase } from '../supabase/client.js';
import { logAudit } from './audit.js';

/** List owners with optional search (name/username) and status filter. */
export async function listOwners({ search = '', status = 'all' } = {}) {
  let query = supabase.from('owners').select('*').order('display_name');
  if (status && status !== 'all') query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw error;
  let rows = data || [];
  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter(
      (o) =>
        o.display_name?.toLowerCase().includes(q) || o.username?.toLowerCase().includes(q),
    );
  }
  return rows;
}

export async function getOwner(id) {
  const { data, error } = await supabase.from('owners').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

/** The owner row for the currently authenticated Owner (used by the portal). */
export async function getMyOwner() {
  const { data, error } = await supabase.from('owners').select('*').maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Update editable Owner fields (Admin only via RLS). Auth-related changes
 * (username -> auth identity, password, enabling/disabling login) are handled
 * by the API routes, not here.
 */
export async function updateOwner(id, patch) {
  const before = await getOwner(id);
  const { data, error } = await supabase
    .from('owners')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;

  const changed = {};
  for (const key of Object.keys(patch)) {
    if (before?.[key] !== data?.[key]) changed[key] = { from: before?.[key], to: data?.[key] };
  }
  if ('safety_reserve_rate' in patch) {
    await logAudit({
      action: 'owner.safety_reserve_changed',
      entityType: 'owner',
      entityId: id,
      metadata: { changed },
    });
  }
  await logAudit({ action: 'owner.updated', entityType: 'owner', entityId: id, metadata: { changed } });
  return data;
}

/** Archive an Owner (soft). History is preserved. Prefer deleteOwner via adminApi for hard delete. */
export async function archiveOwner(id) {
  const { data, error } = await supabase
    .from('owners')
    .update({ status: 'archived' })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  await logAudit({ action: 'owner.archived', entityType: 'owner', entityId: id });
  return data;
}

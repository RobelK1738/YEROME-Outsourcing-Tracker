// Audit logging helper. Admin mutations call logAudit() to record an entry.
// Never log passwords or secrets. Owner-quoted code never writes here (RLS
// restricts audit_log to Admin).

import { supabase } from '../supabase/client.js';

/**
 * Insert an audit entry. Best-effort: audit failures must not break the
 * primary operation, so errors are swallowed after logging to the console.
 */
export async function logAudit({ action, entityType, entityId = null, metadata = {} }) {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.from('audit_log').insert({
      actor_user_id: user?.id ?? null,
      action,
      entity_type: entityType,
      entity_id: entityId,
      metadata_json: sanitize(metadata),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('audit log failed', err?.message || err);
  }
}

// Defensively strip anything that looks like a secret before storing.
function sanitize(metadata) {
  if (!metadata || typeof metadata !== 'object') return {};
  const banned = /pass(word)?|secret|token|service[_-]?role|key/i;
  const clean = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (banned.test(k)) continue;
    clean[k] = v;
  }
  return clean;
}

export async function listAuditLog({ limit = 200 } = {}) {
  const { data, error } = await supabase
    .from('audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// POST /api/owners/create — Admin-only. Creates a Supabase Auth identity for a
// new Owner (from username + password) and the linked owners row, then stamps
// the auth user's app_metadata with { role: 'owner', owner_id }.

import {
  adminClient,
  getEnv,
  requireAdmin,
  readJsonBody,
  validateUsername,
  validatePassword,
  serverAudit,
} from '../_lib/supabaseAdmin.js';

const FILING_STATUSES = ['single', 'mfj', 'mfs', 'hoh'];
const DEAL_TYPES = ['miki_wohabe', 'three_way', 'no_middle'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  const auth = await requireAdmin(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const body = await readJsonBody(req);
  const username = String(body.username || '').toLowerCase().trim();
  const { password, displayName } = body;
  const filingStatus = FILING_STATUSES.includes(body.filingStatus) ? body.filingStatus : 'single';
  const rawDeal = body.dealType === 'two_way' ? 'no_middle' : body.dealType;
  const dealType = DEAL_TYPES.includes(rawDeal) ? rawDeal : 'three_way';
  const state = body.state || 'TX';
  const safetyReserveRate =
    body.safetyReserveRate != null && body.safetyReserveRate !== ''
      ? Number(body.safetyReserveRate)
      : 0.12;
  const notes = body.notes || null;

  const uErr = validateUsername(username);
  if (uErr) return res.status(400).json({ error: uErr });
  const pErr = validatePassword(password);
  if (pErr) return res.status(400).json({ error: pErr });
  if (!displayName || !String(displayName).trim()) {
    return res.status(400).json({ error: 'Display name is required.' });
  }
  if (!(safetyReserveRate >= 0 && safetyReserveRate <= 1)) {
    return res.status(400).json({ error: 'Safety reserve rate must be between 0 and 1.' });
  }

  const admin = adminClient();
  const { ownerAuthDomain } = getEnv();
  const email = `${username}@${ownerAuthDomain}`;

  // Reject duplicate username early with a friendly message.
  const { data: existing } = await admin.from('owners').select('id').eq('username', username).maybeSingle();
  if (existing) return res.status(409).json({ error: 'That username is already taken.' });

  // 1) Create the auth identity.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role: 'owner' },
    user_metadata: { username, display_name: displayName },
  });
  if (createErr || !created?.user) {
    return res.status(400).json({ error: createErr?.message || 'Could not create Owner login.' });
  }
  const authUserId = created.user.id;

  // 2) Insert the owners row.
  const { data: owner, error: ownerErr } = await admin
    .from('owners')
    .insert({
      auth_user_id: authUserId,
      username,
      display_name: String(displayName).trim(),
      filing_status: filingStatus,
      deal_type: dealType,
      state,
      safety_reserve_rate: safetyReserveRate,
      notes,
      status: 'active',
    })
    .select()
    .single();
  if (ownerErr) {
    // Roll back the auth user so we don't orphan an identity.
    await admin.auth.admin.deleteUser(authUserId).catch(() => {});
    return res.status(400).json({ error: ownerErr.message || 'Could not create Owner record.' });
  }

  // 3) Stamp owner_id into app_metadata for fast RLS lookups.
  await admin.auth.admin.updateUserById(authUserId, {
    app_metadata: { role: 'owner', owner_id: owner.id },
  });

  await serverAudit(admin, {
    actorUserId: auth.user.id,
    action: 'owner.created',
    entityType: 'owner',
    entityId: owner.id,
    metadata: { username, display_name: owner.display_name, filing_status: filingStatus },
  });

  return res.status(200).json({ ok: true, owner });
}

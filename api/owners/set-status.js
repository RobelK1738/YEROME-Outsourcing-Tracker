// POST /api/owners/set-status — Admin-only. Updates an Owner's status and can
// enable/disable their login by banning/unbanning the auth identity.

import { adminClient, requireAdmin, readJsonBody, serverAudit } from '../_lib/supabaseAdmin.js';

const STATUSES = ['active', 'inactive', 'archived'];
// Effectively permanent ban to disable a login; 'none' re-enables it.
const BAN_DURATION = '876000h';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  const auth = await requireAdmin(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const body = await readJsonBody(req);
  const { ownerId } = body;
  const status = STATUSES.includes(body.status) ? body.status : null;
  if (!ownerId) return res.status(400).json({ error: 'ownerId is required.' });
  if (!status) return res.status(400).json({ error: 'A valid status is required.' });

  // Disable login automatically for inactive/archived unless told otherwise.
  const disableLogin =
    body.disableLogin != null ? Boolean(body.disableLogin) : status !== 'active';

  const admin = adminClient();
  const { data: owner, error: ownerErr } = await admin
    .from('owners')
    .select('id, auth_user_id, username, status')
    .eq('id', ownerId)
    .maybeSingle();
  if (ownerErr || !owner) return res.status(404).json({ error: 'Owner not found.' });

  const { error: updErr } = await admin.from('owners').update({ status }).eq('id', ownerId);
  if (updErr) return res.status(400).json({ error: updErr.message || 'Could not update status.' });

  if (owner.auth_user_id) {
    await admin.auth.admin
      .updateUserById(owner.auth_user_id, { ban_duration: disableLogin ? BAN_DURATION : 'none' })
      .catch(() => {});
  }

  await serverAudit(admin, {
    actorUserId: auth.user.id,
    action: status === 'archived' ? 'owner.archived' : 'owner.status_changed',
    entityType: 'owner',
    entityId: owner.id,
    metadata: { from: owner.status, to: status, login_disabled: disableLogin },
  });

  return res.status(200).json({ ok: true });
}

// POST /api/owners/reset-password — Admin-only. Sets a replacement password for
// an Owner (there is no email-reset flow in v1). The password is NEVER logged.

import {
  adminClient,
  requireAdmin,
  readJsonBody,
  validatePassword,
  serverAudit,
} from '../_lib/supabaseAdmin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  const auth = await requireAdmin(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const body = await readJsonBody(req);
  const { ownerId, newPassword } = body;
  if (!ownerId) return res.status(400).json({ error: 'ownerId is required.' });
  const pErr = validatePassword(newPassword);
  if (pErr) return res.status(400).json({ error: pErr });

  const admin = adminClient();
  const { data: owner, error: ownerErr } = await admin
    .from('owners')
    .select('id, auth_user_id, username')
    .eq('id', ownerId)
    .maybeSingle();
  if (ownerErr || !owner) return res.status(404).json({ error: 'Owner not found.' });
  if (!owner.auth_user_id) return res.status(400).json({ error: 'Owner has no login to reset.' });

  const { error: updErr } = await admin.auth.admin.updateUserById(owner.auth_user_id, {
    password: newPassword,
  });
  if (updErr) return res.status(400).json({ error: updErr.message || 'Could not reset password.' });

  await serverAudit(admin, {
    actorUserId: auth.user.id,
    action: 'owner.password_reset',
    entityType: 'owner',
    entityId: owner.id,
    metadata: { username: owner.username }, // no password material
  });

  return res.status(200).json({ ok: true });
}

// POST /api/owners/delete — Admin-only. Permanently deletes an Owner, their
// jobs (and cascading children), owner-scoped costs, and Auth login.

import { adminClient, requireAdmin, readJsonBody, serverAudit } from '../_lib/supabaseAdmin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  const auth = await requireAdmin(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const body = await readJsonBody(req);
  const ownerId = body.ownerId;
  if (!ownerId) return res.status(400).json({ error: 'ownerId is required.' });

  const admin = adminClient();
  const { data: owner, error: ownerErr } = await admin
    .from('owners')
    .select('id, auth_user_id, username, display_name')
    .eq('id', ownerId)
    .maybeSingle();
  if (ownerErr || !owner) return res.status(404).json({ error: 'Owner not found.' });

  // jobs.owner_id is ON DELETE RESTRICT — remove jobs first (children cascade).
  const { data: jobs, error: jobsErr } = await admin.from('jobs').select('id').eq('owner_id', ownerId);
  if (jobsErr) return res.status(400).json({ error: jobsErr.message || 'Could not list jobs.' });
  const jobIds = (jobs || []).map((j) => j.id);
  if (jobIds.length) {
    const { error: delJobsErr } = await admin.from('jobs').delete().in('id', jobIds);
    if (delJobsErr) return res.status(400).json({ error: delJobsErr.message || 'Could not delete jobs.' });
  }

  // Owner-scoped costs (per-job costs already cascade with jobs).
  const { error: costsErr } = await admin.from('costs').delete().eq('owner_id', ownerId);
  if (costsErr) return res.status(400).json({ error: costsErr.message || 'Could not delete costs.' });

  const { error: delOwnerErr } = await admin.from('owners').delete().eq('id', ownerId);
  if (delOwnerErr) return res.status(400).json({ error: delOwnerErr.message || 'Could not delete owner.' });

  if (owner.auth_user_id) {
    await admin.auth.admin.deleteUser(owner.auth_user_id).catch(() => {});
  }

  await serverAudit(admin, {
    actorUserId: auth.user.id,
    action: 'owner.deleted',
    entityType: 'owner',
    entityId: owner.id,
    metadata: {
      username: owner.username,
      display_name: owner.display_name,
      jobs_deleted: jobIds.length,
    },
  });

  return res.status(200).json({ ok: true });
}

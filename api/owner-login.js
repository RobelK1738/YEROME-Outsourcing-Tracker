// POST /api/owner-login — public. Maps an Owner username to the internal auth
// email (using OWNER_AUTH_DOMAIN, which stays server-side), signs in with the
// anon client, and returns session tokens for the client to apply. This keeps
// the internal email format out of the browser and out of the Owner UI.

import { anonClient, getEnv, readJsonBody } from './_lib/supabaseAdmin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  const body = await readJsonBody(req);
  const username = String(body.username || '').toLowerCase().trim();
  const { password } = body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const { ownerAuthDomain } = getEnv();
  const email = `${username}@${ownerAuthDomain}`;

  const anon = anonClient();
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data?.session) {
    // Generic message: don't reveal whether the username exists.
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  // Only Owners may sign in through this endpoint.
  const role = data.user?.app_metadata?.role;
  if (role !== 'owner') {
    return res.status(403).json({ error: 'This account cannot sign in as an Owner.' });
  }

  return res.status(200).json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
}

// Client wrappers for the trusted server API routes (Vercel functions).
//
// Privileged Supabase Auth operations (create Owner, reset password, enable/
// disable login) require the service-role key and therefore MUST run on the
// server. These wrappers attach the caller's access token so the server can
// verify the caller is Admin before doing anything.

import { supabase } from '../supabase/client.js';

async function authHeader() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function postAuthed(path, body) {
  const headers = { 'Content-Type': 'application/json', ...(await authHeader()) };
  const res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return json;
}

/** Admin: create an Owner login + owner record in one privileged call. */
export function createOwner(payload) {
  return postAuthed('/api/owners/create', payload);
}

/** Admin: set a new password for an Owner. */
export function resetOwnerPassword(ownerId, newPassword) {
  return postAuthed('/api/owners/reset-password', { ownerId, newPassword });
}

/** Admin: change an Owner's status and enable/disable their login. */
export function setOwnerStatus(ownerId, status, { disableLogin } = {}) {
  return postAuthed('/api/owners/set-status', { ownerId, status, disableLogin });
}

/** Admin: permanently delete an Owner, their jobs, and Auth login. */
export function deleteOwner(ownerId) {
  return postAuthed('/api/owners/delete', { ownerId });
}

/**
 * Owner login by username + password. The server maps the username to the
 * internal auth email (using OWNER_AUTH_DOMAIN, which stays server-side),
 * signs in, and returns session tokens the client applies via setSession().
 */
export async function ownerLogin(username, password) {
  const res = await fetch('/api/owner-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error || 'Invalid username or password.');
    err.status = res.status;
    throw err;
  }
  return json; // { access_token, refresh_token }
}

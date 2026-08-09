// Server-only Supabase helpers for Vercel serverless functions.
//
// SECURITY: This module uses the SERVICE-ROLE key, which bypasses RLS. It must
// NEVER be imported by client code. Files/directories prefixed with "_" are not
// exposed as HTTP routes by Vercel.

import { createClient } from '@supabase/supabase-js';

export function getEnv() {
  return {
    url: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    anonKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    adminEmail: process.env.ADMIN_EMAIL,
    ownerAuthDomain: process.env.OWNER_AUTH_DOMAIN || 'owners.local',
  };
}

/** Service-role client (bypasses RLS). Server use only. */
export function adminClient() {
  const { url, serviceKey } = getEnv();
  if (!url || !serviceKey) throw new Error('Server is missing Supabase configuration.');
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Anon client for privilege-free operations (e.g. Owner password sign-in). */
export function anonClient() {
  const { url, anonKey } = getEnv();
  if (!url || !anonKey) throw new Error('Server is missing Supabase configuration.');
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Verify the caller is the configured Admin. Checks both the app_metadata role
 * AND that the email matches ADMIN_EMAIL (defense in depth). Returns the user.
 */
export async function requireAdmin(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return { ok: false, status: 401, error: 'Missing authorization token.' };

  const admin = adminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return { ok: false, status: 401, error: 'Invalid or expired session.' };

  const { adminEmail } = getEnv();
  const role = data.user.app_metadata?.role;
  const emailMatches =
    !adminEmail || data.user.email?.toLowerCase() === String(adminEmail).toLowerCase();
  if (role !== 'admin' || !emailMatches) {
    return { ok: false, status: 403, error: 'YEROME access required.' };
  }
  return { ok: true, user: data.user };
}

/** Parse a JSON request body defensively (Vercel usually pre-parses it). */
export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return await new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

const USERNAME_RE = /^[a-z0-9_]{3,40}$/;

export function validateUsername(username) {
  if (!username || typeof username !== 'string') return 'Username is required.';
  const u = username.toLowerCase();
  if (!USERNAME_RE.test(u)) {
    return 'Username must be 3-40 characters: lowercase letters, numbers, or underscores.';
  }
  return null;
}

export function validatePassword(password) {
  if (!password || typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters.';
  }
  return null;
}

/** Write an audit entry with the service-role client (never logs secrets). */
export async function serverAudit(admin, { actorUserId, action, entityType, entityId, metadata }) {
  try {
    await admin.from('audit_log').insert({
      actor_user_id: actorUserId ?? null,
      action,
      entity_type: entityType,
      entity_id: entityId ?? null,
      metadata_json: metadata ?? {},
    });
  } catch {
    /* best-effort */
  }
}

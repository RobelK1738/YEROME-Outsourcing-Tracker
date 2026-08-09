// Minimal .env loader for the setup scripts so we avoid an extra dependency.
// Only used by local scripts; not part of the app bundle.

import fs from 'node:fs';
import path from 'node:path';

export function loadEnv() {
  const file = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(file)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      // File values win over a polluted shell env (e.g. leftover ADMIN_EMAIL).
      process.env[key] = value;
    }
  }
  return {
    url: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    anonKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    adminEmail: process.env.ADMIN_EMAIL,
    adminPassword: process.env.ADMIN_PASSWORD,
    ownerAuthDomain: process.env.OWNER_AUTH_DOMAIN || 'owners.local',
  };
}

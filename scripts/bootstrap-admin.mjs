#!/usr/bin/env node
// One-time Admin bootstrap. Creates (or updates) the single Admin auth user for
// the configured ADMIN_EMAIL and stamps app_metadata.role = 'admin' so RLS and
// the API routes recognize it. Uses the SERVICE-ROLE key and must run locally.
//
// Usage:
//   1. Fill ADMIN_EMAIL and ADMIN_PASSWORD (plus Supabase keys) in .env
//   2. npm run bootstrap:admin

import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './_env.mjs';

const env = loadEnv();

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

if (!env.url) fail('Missing SUPABASE_URL / VITE_SUPABASE_URL.');
if (!env.serviceKey) fail('Missing SUPABASE_SERVICE_ROLE_KEY.');
if (!env.adminEmail) fail('Missing ADMIN_EMAIL.');
if (!env.adminPassword) fail('Missing ADMIN_PASSWORD (set it in .env for bootstrapping).');

const admin = createClient(env.url, env.serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findUserByEmail(email) {
  // Paginate through users to find an existing match.
  let page = 1;
  const target = email.toLowerCase();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === target);
    if (match) return match;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

async function main() {
  const email = env.adminEmail;
  const existing = await findUserByEmail(email);

  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password: env.adminPassword,
      app_metadata: { ...(existing.app_metadata || {}), role: 'admin' },
    });
    if (error) fail(`Failed to update Admin user: ${error.message}`);
    console.log(`\n✔ Updated existing Admin user (${email}) with admin role + new password.`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: env.adminPassword,
      email_confirm: true,
      app_metadata: { role: 'admin' },
    });
    if (error) fail(`Failed to create Admin user: ${error.message}`);
    console.log(`\n✔ Created Admin user ${email} (id: ${data.user.id}).`);
  }

  console.log('\nYou can now sign in at /login using the Admin tab with this email + password.');
  console.log('Tip: remove ADMIN_PASSWORD from .env after bootstrapping.\n');
}

main().catch((e) => fail(e.message || String(e)));

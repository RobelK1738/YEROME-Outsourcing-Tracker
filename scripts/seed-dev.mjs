#!/usr/bin/env node
// Attach working Owner logins to the demo data created by supabase/seed.sql, and
// (re)compute fixed-cost allocations so the demo is fully explorable. Local dev
// only — uses the SERVICE-ROLE key. Run supabase/seed.sql FIRST.
//
// Usage:  npm run seed:dev
//   Optional: OWNER_SEED_PASSWORD (defaults to "ownerpass123").

import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './_env.mjs';
import { generatePayDates, todayISO } from '../src/lib/formatting/dates.js';

const env = loadEnv();
const password = process.env.OWNER_SEED_PASSWORD || 'ownerpass123';

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}
if (!env.url) fail('Missing SUPABASE_URL / VITE_SUPABASE_URL.');
if (!env.serviceKey) fail('Missing SUPABASE_SERVICE_ROLE_KEY.');

const admin = createClient(env.url, env.serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SEED_OWNERS = [
  { id: '11111111-1111-1111-1111-111111111111', username: 'owner_a' },
  { id: '22222222-2222-2222-2222-222222222222', username: 'owner_b' },
];

async function findUserByEmail(email) {
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

async function ensureOwnerLogin(owner) {
  const email = `${owner.username}@${env.ownerAuthDomain}`;
  const appMeta = { role: 'owner', owner_id: owner.id };
  let user = await findUserByEmail(email);
  if (user) {
    await admin.auth.admin.updateUserById(user.id, { password, app_metadata: appMeta });
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: appMeta,
      user_metadata: { username: owner.username },
    });
    if (error) throw error;
    user = data.user;
  }
  const { error: upErr } = await admin
    .from('owners')
    .update({ auth_user_id: user.id })
    .eq('id', owner.id);
  if (upErr) throw upErr;
  return { username: owner.username, email };
}

async function recomputeFixedAllocations() {
  const { data: fixed } = await admin
    .from('costs')
    .select('id, owner_id, allocation_method')
    .eq('cost_type', 'fixed')
    .eq('active', true)
    .in('allocation_method', ['equal_all', 'equal_owner']);
  const { data: jobs } = await admin.from('jobs').select('id, owner_id').eq('status', 'active');
  for (const cost of fixed || []) {
    const targets =
      cost.allocation_method === 'equal_owner'
        ? (jobs || []).filter((j) => j.owner_id === cost.owner_id)
        : jobs || [];
    await admin.from('cost_allocations').delete().eq('cost_id', cost.id);
    if (targets.length) {
      const pct = Number((100 / targets.length).toFixed(4));
      await admin
        .from('cost_allocations')
        .insert(targets.map((j) => ({ cost_id: cost.id, job_id: j.id, allocation_percentage: pct })));
    }
  }
}

async function generateDemoSchedules() {
  const { data: jobs } = await admin
    .from('jobs')
    .select('id, pay_frequency')
    .eq('status', 'active');
  const start = todayISO();
  let created = 0;
  for (const job of jobs || []) {
    const dates = generatePayDates(start, 6, job.pay_frequency || 'biweekly');
    const rows = dates.map((pay_date) => ({ job_id: job.id, pay_date, status: 'scheduled' }));
    const { error } = await admin
      .from('job_paychecks')
      .upsert(rows, { onConflict: 'job_id,pay_date', ignoreDuplicates: true });
    if (!error) created += rows.length;
  }
  return created;
}

async function main() {
  // Verify the SQL seed has run.
  const { data: check } = await admin.from('owners').select('id').eq('id', SEED_OWNERS[0].id).maybeSingle();
  if (!check) fail('Demo owners not found. Run supabase/seed.sql first.');

  const results = [];
  for (const owner of SEED_OWNERS) results.push(await ensureOwnerLogin(owner));
  await recomputeFixedAllocations();
  await generateDemoSchedules();

  console.log('\n✔ Demo Owner logins ready (username / password):');
  for (const r of results) console.log(`   • ${r.username} / ${password}`);
  console.log('\nFixed-cost allocations recomputed and demo paycheck schedules generated.');
  console.log('Sign in via the Owner tab at /login.\n');
}

main().catch((e) => fail(e.message || String(e)));

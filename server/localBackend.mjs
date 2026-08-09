#!/usr/bin/env node
// ============================================================================
// LOCAL DEV BACKEND (SQLite) — development only.
//
// This is a zero-install local stand-in for Supabase, backed by Node's built-in
// SQLite (node:sqlite). It lets the app run locally without a cloud account or
// Docker. It emulates the small slice of Supabase the app uses:
//   * Auth (password sign-in, HMAC session tokens, roles in "app_metadata")
//   * A data query protocol consumed by src/lib/supabase/localClient.js
//   * The owner_earned_commissions RPC (computed with the real calc engine)
//   * The privileged /api/* routes (create owner, reset password, set status,
//     owner-login) mirrored against SQLite
//   * RLS-EQUIVALENT authorization enforced per role in this server
//
// IMPORTANT: authorization/RLS here is emulated in application code for local
// development. Production runs on Supabase where real PostgreSQL RLS enforces
// the same rules. Never use this server in production.
// ============================================================================

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { ownerTaxEstimate } from '../src/lib/calculations/tax.js';
import { costToAnnual } from '../src/lib/calculations/costs.js';
import { commissionAnnual } from '../src/lib/calculations/commission.js';
import { TAX_CONFIG_2026 } from '../src/lib/calculations/taxConfig2026.js';
import { generatePayDates, todayISO } from '../src/lib/formatting/dates.js';

// ---------------------------------------------------------------------------
// Config — loaded from .env.local / .env (see .env.local.example).
// Credentials and ports are NOT hardcoded; missing required vars fail loudly.
// ---------------------------------------------------------------------------
loadEnvFiles();

function requireEnv(name) {
  const value = process.env[name];
  if (value == null || String(value).trim() === '') {
    console.error(`\n✖ Missing required environment variable: ${name}`);
    console.error('  Set it in .env.local (see .env.local.example), then re-run ./runAppLocally.sh\n');
    process.exit(1);
  }
  return String(value).trim();
}

const CONFIG = {
  port: Number(requireEnv('LOCAL_PORT')),
  dbFile: path.resolve(process.cwd(), requireEnv('LOCAL_DB_FILE')),
  jwtSecret: requireEnv('LOCAL_JWT_SECRET'),
  adminEmail: requireEnv('ADMIN_EMAIL').toLowerCase(),
  adminPassword: requireEnv('ADMIN_PASSWORD'),
  ownerSeedPassword: requireEnv('OWNER_SEED_PASSWORD'),
  ownerAuthDomain: requireEnv('OWNER_AUTH_DOMAIN'),
  taxYear: Number(requireEnv('DEFAULT_TAX_YEAR')),
};

if (!Number.isFinite(CONFIG.port) || CONFIG.port <= 0) {
  console.error('\n✖ LOCAL_PORT must be a positive number.\n');
  process.exit(1);
}
if (!Number.isFinite(CONFIG.taxYear) || CONFIG.taxYear < 2000) {
  console.error('\n✖ DEFAULT_TAX_YEAR must be a valid year.\n');
  process.exit(1);
}

const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const BOOLEAN_COLS = {
  costs: new Set(['active', 'owner_visible']),
  cost_templates: new Set(['active', 'owner_visible', 'is_default']),
  referrals: new Set(['active', 'visible_to_referred']),
  transfer_instructions: new Set(['active']),
};
const JSON_COLS = {
  tax_year_settings: new Set(['federal_brackets_json']),
  paycheck_entries: new Set(['instruction_snapshot_json']),
  audit_log: new Set(['metadata_json']),
  cost_templates: new Set(['quoted_by_deal']),
};
const UPSERT_PK = { cost_internal_details: ['cost_id'], business_settings: ['id'] };

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------
fs.mkdirSync(path.dirname(CONFIG.dbFile), { recursive: true });
const db = new DatabaseSync(CONFIG.dbFile);
db.exec('PRAGMA foreign_keys = ON;');
createSchema();
migrateSchema();
const COLS = introspectColumns();
bootstrapAdmin();
seedDefaultCostTemplates();
seedDemoIfEmpty();

function createSchema() {
  db.exec(`
    create table if not exists owners (
      id text primary key, auth_user_id text, username text unique, display_name text,
      filing_status text, state text, safety_reserve_rate real,
      deal_type text default 'three_way', owner_profit_share_rate real,
      other_income_adjustment_cents integer default 0, deduction_adjustment_cents integer default 0,
      status text default 'active', notes text, created_at text, updated_at text
    );
    create table if not exists jobs (
      id text primary key, owner_id text, employer_name text, role_title text,
      annual_salary_cents integer default 0, projected_tax_year_wages_cents integer,
      pay_frequency text default 'biweekly', pay_periods_per_year integer default 26,
      safety_reserve_rate real, start_date text, end_date text, status text default 'active',
      notes text, created_at text, updated_at text
    );
    create table if not exists costs (
      id text primary key, owner_id text, job_id text, name text, cost_type text,
      cadence text default 'monthly', quoted_amount_cents integer default 0,
      allocation_method text default 'none', start_date text, end_date text,
      active integer default 1, owner_visible integer default 1, notes text,
      created_at text, updated_at text
    );
    create table if not exists cost_internal_details (
      cost_id text primary key, actual_amount_cents integer default 0, internal_notes text,
      created_at text, updated_at text
    );
    create table if not exists cost_templates (
      id text primary key, name text unique, cost_type text, cadence text default 'monthly',
      quoted_amount_cents integer default 0, actual_amount_cents integer default 0,
      allocation_method text default 'none', owner_visible integer default 1,
      is_default integer default 0, active integer default 1, notes text, internal_notes text,
      quoted_by_deal text, created_at text, updated_at text
    );
    create table if not exists business_settings (
      id integer primary key check (id = 1),
      gang_reserve_rate real default 0.12, gang_cut_rate real default 0.10, updated_at text
    );
    create table if not exists cost_allocations (
      id text primary key, cost_id text, job_id text, allocation_percentage real default 0,
      created_at text, unique(cost_id, job_id)
    );
    create table if not exists referrals (
      id text primary key, referrer_owner_id text, referred_owner_id text,
      commission_rate real default 0.1, commission_basis_type text, flat_amount_cents integer,
      visible_to_referred integer default 0, start_date text, end_date text, active integer default 1,
      notes text, created_at text, updated_at text
    );
    create table if not exists referral_jobs (
      referral_id text, job_id text, primary key(referral_id, job_id)
    );
    create table if not exists transfer_instructions (
      id text primary key, owner_id text, job_id text, label text, destination text,
      payment_method text, amount_type text default 'informational', amount_value real,
      instructions text, sort_order integer default 0, active integer default 1,
      created_at text, updated_at text
    );
    create table if not exists tax_year_settings (
      year integer, filing_status text, standard_deduction_cents integer,
      federal_brackets_json text, social_security_rate real, social_security_wage_base_cents integer,
      medicare_rate real, additional_medicare_rate real, additional_medicare_threshold_cents integer,
      state_income_tax_rate real, created_at text, updated_at text,
      primary key(year, filing_status)
    );
    create table if not exists pay_cycles (
      id text primary key, label text, period_start text, period_end text, pay_date text,
      status text default 'planned', created_at text
    );
    create table if not exists paycheck_entries (
      id text primary key, pay_cycle_id text, job_id text, expected_gross_cents integer default 0,
      actual_net_received_cents integer, estimated_tax_cents integer default 0,
      safety_reserve_cents integer default 0, quoted_costs_cents integer default 0,
      commission_in_cents integer default 0, commission_out_cents integer default 0,
      recommended_remaining_cents integer default 0, instruction_snapshot_json text, created_at text,
      unique(pay_cycle_id, job_id)
    );
    create table if not exists job_paychecks (
      id text primary key, job_id text, pay_date text, period_start text, period_end text,
      status text default 'scheduled', expected_gross_cents integer, actual_net_received_cents integer,
      notes text, created_at text, updated_at text, unique(job_id, pay_date)
    );
    create table if not exists audit_log (
      id text primary key, actor_user_id text, action text, entity_type text, entity_id text,
      metadata_json text, created_at text
    );
    create table if not exists auth_users (
      id text primary key, email text unique, username text, password_hash text,
      role text, owner_id text, display_name text, banned integer default 0, created_at text
    );
  `);

  // Seed tax config (idempotent) from the shared 2026 definition.
  for (const [fs_, cfg] of Object.entries(TAX_CONFIG_2026)) {
    const exists = db
      .prepare('select 1 from tax_year_settings where year = ? and filing_status = ?')
      .get(CONFIG.taxYear, fs_);
    if (!exists) {
      db.prepare(
        `insert into tax_year_settings (year, filing_status, standard_deduction_cents, federal_brackets_json,
          social_security_rate, social_security_wage_base_cents, medicare_rate, additional_medicare_rate,
          additional_medicare_threshold_cents, state_income_tax_rate, created_at, updated_at)
         values (?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        CONFIG.taxYear,
        fs_,
        cfg.standard_deduction_cents,
        JSON.stringify(cfg.federal_brackets),
        cfg.social_security_rate,
        cfg.social_security_wage_base_cents,
        cfg.medicare_rate,
        cfg.additional_medicare_rate,
        cfg.additional_medicare_threshold_cents,
        cfg.state_income_tax_rate,
        nowISO(),
        nowISO(),
      );
    }
  }
}

function tableHasColumn(table, column) {
  return db.prepare(`pragma table_info(${table})`).all().some((c) => c.name === column);
}

function migrateSchema() {
  if (!tableHasColumn('cost_templates', 'quoted_by_deal')) {
    db.exec('alter table cost_templates add column quoted_by_deal text');
  }
  db.exec(`
    create table if not exists business_settings (
      id integer primary key check (id = 1),
      gang_reserve_rate real default 0.12, gang_cut_rate real default 0.10, updated_at text
    )
  `);
  if (!db.prepare('select 1 from business_settings where id = 1').get()) {
    db.prepare('insert into business_settings (id, gang_reserve_rate, gang_cut_rate, updated_at) values (1, 0.12, 0.10, ?)').run(nowISO());
  }
  db.prepare("update owners set deal_type = 'no_middle' where deal_type = 'two_way'").run();
}

function introspectColumns() {
  const tables = db.prepare("select name from sqlite_master where type='table'").all();
  const map = {};
  for (const { name } of tables) {
    const info = db.prepare(`PRAGMA table_info(${name})`).all();
    map[name] = new Set(info.map((c) => c.name));
  }
  return map;
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
}
function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
function signToken(claims) {
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const payload = b64url({ ...claims, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 });
  const data = `${header}.${payload}`;
  const sig = crypto.createHmac('sha256', CONFIG.jwtSecret).update(data).digest('base64url');
  return `${data}.${sig}`;
}
function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const expected = crypto.createHmac('sha256', CONFIG.jwtSecret).update(`${parts[0]}.${parts[1]}`).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(parts[2]), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
function sessionForUser(u) {
  const claims = {
    sub: u.id,
    email: u.email,
    role: u.role,
    owner_id: u.owner_id || null,
    display_name: u.display_name || null,
    username: u.username || null,
  };
  const token = signToken(claims);
  return {
    access_token: token,
    refresh_token: token,
    token_type: 'bearer',
    user: userObject(claims),
  };
}
function userObject(claims) {
  return {
    id: claims.sub,
    email: claims.email,
    app_metadata: { role: claims.role, owner_id: claims.owner_id || undefined },
    user_metadata: { display_name: claims.display_name || undefined, username: claims.username || undefined },
  };
}
function ctxFromReq(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = verifyToken(token);
  if (!payload) return { role: 'anon' };
  return {
    role: payload.role,
    userId: payload.sub,
    ownerId: payload.owner_id || null,
    email: payload.email,
  };
}

function bootstrapAdmin() {
  const existing = db.prepare('select * from auth_users where email = ?').get(CONFIG.adminEmail);
  if (existing) {
    db.prepare('update auth_users set password_hash = ?, role = ? where id = ?').run(
      hashPassword(CONFIG.adminPassword),
      'admin',
      existing.id,
    );
  } else {
    db.prepare(
      'insert into auth_users (id, email, username, password_hash, role, display_name, banned, created_at) values (?,?,?,?,?,?,0,?)',
    ).run(crypto.randomUUID(), CONFIG.adminEmail, null, hashPassword(CONFIG.adminPassword), 'admin', 'Administrator', nowISO());
  }
}

// ---------------------------------------------------------------------------
// Value conversion (SQLite integers/strings <-> JS booleans/JSON)
// ---------------------------------------------------------------------------
function toStore(table, key, value) {
  if (value === undefined) return undefined;
  if (BOOLEAN_COLS[table]?.has(key)) return value ? 1 : 0;
  if (JSON_COLS[table]?.has(key)) return value == null ? null : JSON.stringify(value);
  return value;
}
function fromDbRow(table, row) {
  if (!row) return row;
  const out = { ...row };
  for (const key of Object.keys(out)) {
    if (BOOLEAN_COLS[table]?.has(key)) out[key] = Boolean(out[key]);
    else if (JSON_COLS[table]?.has(key)) {
      try {
        out[key] = out[key] == null ? null : JSON.parse(out[key]);
      } catch {
        /* leave as-is */
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Query engine
// ---------------------------------------------------------------------------
function buildWhere(table, filters = []) {
  const where = [];
  const params = [];
  for (const f of filters) {
    if (!IDENT.test(f.col)) throw new Error(`Invalid column: ${f.col}`);
    if (f.op === 'eq') {
      where.push(`${f.col} = ?`);
      params.push(toStore(table, f.col, f.val));
    } else if (f.op === 'in') {
      const arr = f.val || [];
      if (!arr.length) {
        where.push('0 = 1');
      } else {
        where.push(`${f.col} IN (${arr.map(() => '?').join(',')})`);
        params.push(...arr.map((v) => toStore(table, f.col, v)));
      }
    } else if (f.op === 'gte') {
      where.push(`${f.col} >= ?`);
      params.push(f.val);
    } else if (f.op === 'is' && f.val === null) {
      where.push(`${f.col} IS NULL`);
    }
  }
  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

function rawSelect(table, { filters = [], order = [], limit } = {}) {
  if (!COLS[table]) throw new Error(`Unknown table: ${table}`);
  const { clause, params } = buildWhere(table, filters);
  let sql = `SELECT * FROM ${table} ${clause}`;
  if (order.length) {
    const parts = order
      .filter((o) => IDENT.test(o.col))
      .map((o) => `${o.col} ${o.ascending === false ? 'DESC' : 'ASC'}`);
    if (parts.length) sql += ` ORDER BY ${parts.join(', ')}`;
  }
  if (limit != null) sql += ` LIMIT ${Number(limit) || 0}`;
  return db.prepare(sql).all(...params).map((r) => ({ ...r }));
}

// --- Owner authorization sets (RLS emulation) ---
function ownerJobIds(ownerId) {
  return new Set(db.prepare('select id from jobs where owner_id = ?').all(ownerId).map((r) => r.id));
}
function ownerAllocatedCostIds(ownerId) {
  return new Set(
    db
      .prepare(
        'select distinct ca.cost_id as id from cost_allocations ca join jobs j on j.id = ca.job_id where j.owner_id = ?',
      )
      .all(ownerId)
      .map((r) => r.id),
  );
}
function ownerReferrerReferralIds(ownerId) {
  return new Set(db.prepare('select id from referrals where referrer_owner_id = ?').all(ownerId).map((r) => r.id));
}
function costOwnerVisibleMap() {
  const map = new Map();
  for (const r of db.prepare('select id, owner_visible from costs').all()) map.set(r.id, Boolean(r.owner_visible));
  return map;
}

function applyOwnerRls(table, rows, ctx) {
  const oid = ctx.ownerId;
  switch (table) {
    case 'owners':
      return rows.filter((r) => r.id === oid);
    case 'jobs':
      return rows.filter((r) => r.owner_id === oid);
    case 'costs': {
      const jobIds = ownerJobIds(oid);
      const allocIds = ownerAllocatedCostIds(oid);
      return rows.filter(
        (r) => r.owner_visible && (r.owner_id === oid || jobIds.has(r.job_id) || allocIds.has(r.id)),
      );
    }
    case 'cost_internal_details':
    // Templates carry actual amounts, so they stay YEROME-only.
    case 'cost_templates':
    case 'business_settings':
      return [];
    case 'cost_allocations': {
      const jobIds = ownerJobIds(oid);
      const vis = costOwnerVisibleMap();
      return rows.filter((r) => jobIds.has(r.job_id) && vis.get(r.cost_id));
    }
    case 'referrals':
      return rows.filter((r) => r.referrer_owner_id === oid || (r.referred_owner_id === oid && r.visible_to_referred));
    case 'referral_jobs': {
      const refIds = ownerReferrerReferralIds(oid);
      return rows.filter((r) => refIds.has(r.referral_id));
    }
    case 'transfer_instructions':
      return rows.filter((r) => r.owner_id === oid && r.active);
    case 'paycheck_entries':
    case 'job_paychecks': {
      const jobIds = ownerJobIds(oid);
      return rows.filter((r) => jobIds.has(r.job_id));
    }
    case 'tax_year_settings':
    case 'pay_cycles':
      return rows;
    case 'audit_log':
      return [];
    default:
      return [];
  }
}

// --- Embeds (PostgREST-style alias:table(cols) resolution) ---
function parseEmbeds(columns) {
  if (!columns || columns === '*') return [];
  const embeds = [];
  const re = /(\w+):(\w+)(?:!(\w+))?\(([^)]*)\)/g;
  let m;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(columns))) {
    embeds.push({ alias: m[1], table: m[2], fkHint: m[3] || null, cols: m[4] });
  }
  return embeds;
}
function fkColumnFor(baseTable, embed) {
  if (embed.fkHint) {
    return embed.fkHint.replace(/_fkey$/, '').replace(new RegExp(`^${baseTable}_`), '');
  }
  return `${embed.alias}_id`;
}
function resolveEmbeds(baseTable, rows, columns) {
  const embeds = parseEmbeds(columns);
  if (!embeds.length) return rows;
  for (const embed of embeds) {
    if (!COLS[embed.table]) continue;
    const fkCol = fkColumnFor(baseTable, embed);
    const getStmt = db.prepare(`SELECT * FROM ${embed.table} WHERE id = ?`);
    for (const row of rows) {
      const parentId = row[fkCol];
      const parent = parentId != null ? getStmt.get(parentId) : null;
      row[embed.alias] = parent ? fromDbRow(embed.table, { ...parent }) : null;
    }
  }
  return rows;
}

function reduceSingle(rows, single) {
  if (single === 'one' || single === 'maybe') return rows.length ? rows[0] : null;
  return rows;
}

function handleSelect(body, ctx) {
  const { table, columns = '*', filters = [], order = [], limit, single = null } = body;
  if (!COLS[table]) return { error: { message: `Unknown table: ${table}` } };
  if (ctx.role === 'anon') return { data: reduceSingle([], single) };

  let rows = rawSelect(table, { filters, order, limit });
  if (ctx.role === 'owner') rows = applyOwnerRls(table, rows, ctx);
  rows = resolveEmbeds(table, rows, columns);
  const converted = rows.map((r) => fromDbRow(table, r));
  return { data: reduceSingle(converted, single) };
}

function prepInsertRow(table, obj) {
  const row = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!COLS[table].has(k)) continue;
    row[k] = toStore(table, k, v);
  }
  if (COLS[table].has('id') && (row.id == null || row.id === '')) row.id = crypto.randomUUID();
  if (COLS[table].has('created_at') && row.created_at == null) row.created_at = nowISO();
  if (COLS[table].has('updated_at')) row.updated_at = nowISO();
  return row;
}
function insertRow(table, obj) {
  const row = prepInsertRow(table, obj);
  const keys = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(
    ...keys.map((k) => row[k]),
  );
  return row;
}

function handleInsert(body, ctx) {
  if (ctx.role !== 'admin') return { error: { message: 'Admin access required.' } };
  const { table, values, returning } = body;
  if (!COLS[table]) return { error: { message: `Unknown table: ${table}` } };
  const arr = Array.isArray(values) ? values : [values];
  const inserted = [];
  const tx = db.prepare('select 1'); // placeholder to keep style; run inline
  void tx;
  try {
    for (const obj of arr) inserted.push(insertRow(table, obj));
  } catch (e) {
    return { error: { message: e.message } };
  }
  if (!returning) return { data: null };
  const ids = inserted.map((r) => r.id).filter(Boolean);
  const rows = ids.length ? rawSelect(table, { filters: [{ col: 'id', op: 'in', val: ids }] }) : inserted;
  return { data: reduceSingle(rows.map((r) => fromDbRow(table, r)), body.single) };
}

function handleUpdate(body, ctx) {
  if (ctx.role !== 'admin') return { error: { message: 'Admin access required.' } };
  const { table, patch, filters = [], returning } = body;
  if (!COLS[table]) return { error: { message: `Unknown table: ${table}` } };
  const setKeys = Object.keys(patch).filter((k) => COLS[table].has(k));
  if (COLS[table].has('updated_at') && !setKeys.includes('updated_at')) setKeys.push('updated_at');
  const setVals = setKeys.map((k) => (k === 'updated_at' ? nowISO() : toStore(table, k, patch[k])));
  const { clause, params } = buildWhere(table, filters);
  try {
    db.prepare(`UPDATE ${table} SET ${setKeys.map((k) => `${k} = ?`).join(', ')} ${clause}`).run(...setVals, ...params);
  } catch (e) {
    return { error: { message: e.message } };
  }
  if (!returning) return { data: null };
  const rows = rawSelect(table, { filters });
  return { data: reduceSingle(rows.map((r) => fromDbRow(table, r)), body.single) };
}

function handleDelete(body, ctx) {
  if (ctx.role !== 'admin') return { error: { message: 'Admin access required.' } };
  const { table, filters = [] } = body;
  if (!COLS[table]) return { error: { message: `Unknown table: ${table}` } };
  const { clause, params } = buildWhere(table, filters);
  try {
    db.prepare(`DELETE FROM ${table} ${clause}`).run(...params);
  } catch (e) {
    return { error: { message: e.message } };
  }
  return { data: null };
}

function handleUpsert(body, ctx) {
  if (ctx.role !== 'admin') return { error: { message: 'Admin access required.' } };
  const { table, values, onConflict, returning } = body;
  if (!COLS[table]) return { error: { message: `Unknown table: ${table}` } };
  const arr = Array.isArray(values) ? values : [values];
  const conflictCols = (onConflict ? String(onConflict).split(',') : UPSERT_PK[table] || ['id']).map((c) => c.trim());
  const result = [];
  try {
    for (const obj of arr) {
      const where = conflictCols.map((c) => ({ col: c, op: 'eq', val: obj[c] }));
      const existing = conflictCols.every((c) => obj[c] != null) ? rawSelect(table, { filters: where }) : [];
      if (existing.length) {
        if (!body.ignoreDuplicates) {
          const patchKeys = Object.keys(obj).filter((k) => COLS[table].has(k) && !conflictCols.includes(k));
          if (COLS[table].has('updated_at')) patchKeys.push('updated_at');
          const vals = patchKeys.map((k) => (k === 'updated_at' ? nowISO() : toStore(table, k, obj[k])));
          const { clause, params } = buildWhere(table, where);
          db.prepare(`UPDATE ${table} SET ${patchKeys.map((k) => `${k} = ?`).join(', ')} ${clause}`).run(...vals, ...params);
        }
        result.push(existing[0]);
      } else {
        result.push(insertRow(table, obj));
      }
    }
  } catch (e) {
    return { error: { message: e.message } };
  }
  if (!returning) return { data: null };
  return { data: reduceSingle(result.map((r) => fromDbRow(table, r)), body.single) };
}

// ---------------------------------------------------------------------------
// RPCs (computed with the real calculation engine)
// ---------------------------------------------------------------------------
function getSettings(filingStatus, year) {
  const row = db
    .prepare('select * from tax_year_settings where year = ? and filing_status = ?')
    .get(year, filingStatus);
  return row ? fromDbRow('tax_year_settings', { ...row }) : null;
}
function ownerActiveWages(ownerId) {
  const jobs = db.prepare("select * from jobs where owner_id = ? and status = 'active'").all(ownerId);
  return jobs.reduce((s, j) => s + (j.projected_tax_year_wages_cents ?? j.annual_salary_cents ?? 0), 0);
}
function ownerQuotedCostsAnnual(ownerId) {
  const perJob = db
    .prepare(
      `select co.quoted_amount_cents as q, co.cadence as c from costs co join jobs j on j.id = co.job_id
       where co.cost_type='per_job' and co.active=1 and co.owner_visible=1 and j.owner_id=? and j.status='active'`,
    )
    .all(ownerId)
    .reduce((s, r) => s + costToAnnual(r.q, r.c), 0);
  const fixed = db
    .prepare(
      `select co.quoted_amount_cents as q, co.cadence as c, ca.allocation_percentage as p
       from cost_allocations ca join costs co on co.id = ca.cost_id join jobs j on j.id = ca.job_id
       where co.cost_type='fixed' and co.active=1 and co.owner_visible=1 and j.owner_id=? and j.status='active'`,
    )
    .all(ownerId)
    .reduce((s, r) => s + Math.round((costToAnnual(r.q, r.c) * Number(r.p)) / 100), 0);
  return perJob + fixed;
}
function ownerFinancials(ownerId, year) {
  const owner = db.prepare('select * from owners where id = ?').get(ownerId);
  if (!owner) return { gross: 0, tax: 0, reserve: 0, quoted: 0, distributable: 0 };
  const settings = getSettings(owner.filing_status, year);
  const gross = ownerActiveWages(ownerId);
  const est = ownerTaxEstimate({
    grossWagesCents: gross,
    settings,
    otherIncomeAdjCents: owner.other_income_adjustment_cents || 0,
  });
  const quoted = ownerQuotedCostsAnnual(ownerId);
  const afterTax = Math.max(0, gross - est.totalTaxCents);
  const reserve = Math.round(afterTax * (owner.safety_reserve_rate || 0));
  // Commission basis: net after tax + fabricated/quoted costs.
  const distributable = Math.max(0, gross - est.totalTaxCents - quoted);
  return { gross, tax: est.totalTaxCents, reserve, quoted, distributable };
}
function ownerEarnedCommissions(pOwner, year, ctx) {
  const target = pOwner || ctx.ownerId;
  if (!target) return { data: [] };
  if (ctx.role !== 'admin' && target !== ctx.ownerId) return { error: { message: 'not authorized' } };
  const refs = db.prepare('select * from referrals where referrer_owner_id = ?').all(target);
  const out = [];
  for (const r of refs) {
    const referral = { ...r };
    let basis = 0;
    let comm = 0;
    if (referral.commission_basis_type === 'referred_gross_wages') {
      basis = ownerActiveWages(referral.referred_owner_id);
      comm = commissionAnnual({ ...referral }, { referredGrossAnnualCents: basis });
    } else if (referral.commission_basis_type === 'referred_distributable') {
      basis = ownerFinancials(referral.referred_owner_id, year).distributable;
      comm = commissionAnnual({ ...referral }, { referredDistributableAnnualCents: basis });
    } else if (referral.commission_basis_type === 'selected_jobs') {
      basis = db
        .prepare(
          `select coalesce(sum(coalesce(j.projected_tax_year_wages_cents, j.annual_salary_cents)),0) as s
           from referral_jobs rj join jobs j on j.id = rj.job_id where rj.referral_id = ? and j.status='active'`,
        )
        .get(referral.id).s;
      comm = commissionAnnual({ ...referral }, { selectedJobsAnnualCents: basis });
    } else if (referral.commission_basis_type === 'flat_per_paycheck') {
      basis = (referral.flat_amount_cents || 0) * 26;
      comm = commissionAnnual({ ...referral }, { payPeriods: 26 });
    } else if (referral.commission_basis_type === 'custom_manual') {
      basis = referral.flat_amount_cents || 0;
      comm = commissionAnnual({ ...referral }, {});
    }
    const referred = db.prepare('select display_name from owners where id = ?').get(referral.referred_owner_id);
    out.push({
      referral_id: referral.id,
      referred_owner_id: referral.referred_owner_id,
      referred_display_name: referred?.display_name || null,
      commission_rate: referral.commission_rate,
      commission_basis_type: referral.commission_basis_type,
      flat_amount_cents: referral.flat_amount_cents,
      basis_annual_cents: basis,
      annual_commission_cents: referral.active ? comm : 0,
      visible_to_referred: Boolean(referral.visible_to_referred),
      active: Boolean(referral.active),
      notes: referral.notes,
    });
  }
  return { data: out };
}

// ---------------------------------------------------------------------------
// Admin / auth endpoints (mirror the Vercel /api routes against SQLite)
// ---------------------------------------------------------------------------
function requireAdminCtx(ctx) {
  if (ctx.role !== 'admin' || (CONFIG.adminEmail && ctx.email?.toLowerCase() !== CONFIG.adminEmail)) {
    return false;
  }
  return true;
}

function apiCreateOwner(ctx, body) {
  if (!requireAdminCtx(ctx)) return { status: 403, json: { error: 'Admin access required.' } };
  const username = String(body.username || '').toLowerCase().trim();
  const { password, displayName } = body;
  const filingStatus = ['single', 'mfj', 'mfs', 'hoh'].includes(body.filingStatus) ? body.filingStatus : 'single';
  if (!/^[a-z0-9_]{3,40}$/.test(username)) return { status: 400, json: { error: 'Invalid username.' } };
  if (!password || String(password).length < 8) return { status: 400, json: { error: 'Password must be at least 8 characters.' } };
  if (!displayName?.trim()) return { status: 400, json: { error: 'Display name is required.' } };
  if (db.prepare('select 1 from owners where username = ?').get(username)) {
    return { status: 409, json: { error: 'That username is already taken.' } };
  }
  const authId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const email = `${username}@${CONFIG.ownerAuthDomain}`;
  db.prepare(
    'insert into auth_users (id, email, username, password_hash, role, owner_id, display_name, banned, created_at) values (?,?,?,?,?,?,?,0,?)',
  ).run(authId, email, username, hashPassword(password), 'owner', ownerId, displayName.trim(), nowISO());
  const dealType = ['miki_wohabe', 'three_way', 'no_middle', 'two_way'].includes(body.dealType)
    ? (body.dealType === 'two_way' ? 'no_middle' : body.dealType)
    : 'three_way';
  insertRow('owners', {
    id: ownerId,
    auth_user_id: authId,
    username,
    display_name: displayName.trim(),
    filing_status: filingStatus,
    deal_type: dealType,
    state: body.state || 'TX',
    safety_reserve_rate: body.safetyReserveRate != null ? Number(body.safetyReserveRate) : 0.12,
    other_income_adjustment_cents: 0,
    deduction_adjustment_cents: 0,
    status: 'active',
    notes: body.notes || null,
  });
  serverAudit(ctx.userId, 'owner.created', 'owner', ownerId, {
    username,
    display_name: displayName.trim(),
    deal_type: dealType,
  });
  const owner = fromDbRow('owners', { ...db.prepare('select * from owners where id = ?').get(ownerId) });
  return { status: 200, json: { ok: true, owner } };
}

function apiResetPassword(ctx, body) {
  if (!requireAdminCtx(ctx)) return { status: 403, json: { error: 'Admin access required.' } };
  const { ownerId, newPassword } = body;
  if (!ownerId) return { status: 400, json: { error: 'ownerId is required.' } };
  if (!newPassword || String(newPassword).length < 8) return { status: 400, json: { error: 'Password must be at least 8 characters.' } };
  const auth = db.prepare('select * from auth_users where owner_id = ?').get(ownerId);
  if (!auth) return { status: 404, json: { error: 'Owner login not found.' } };
  db.prepare('update auth_users set password_hash = ? where id = ?').run(hashPassword(newPassword), auth.id);
  serverAudit(ctx.userId, 'owner.password_reset', 'owner', ownerId, { username: auth.username });
  return { status: 200, json: { ok: true } };
}

function apiSetStatus(ctx, body) {
  if (!requireAdminCtx(ctx)) return { status: 403, json: { error: 'Admin access required.' } };
  const { ownerId } = body;
  const status = ['active', 'inactive', 'archived'].includes(body.status) ? body.status : null;
  if (!ownerId || !status) return { status: 400, json: { error: 'ownerId and a valid status are required.' } };
  const owner = db.prepare('select * from owners where id = ?').get(ownerId);
  if (!owner) return { status: 404, json: { error: 'Owner not found.' } };
  const disableLogin = body.disableLogin != null ? Boolean(body.disableLogin) : status !== 'active';
  db.prepare('update owners set status = ?, updated_at = ? where id = ?').run(status, nowISO(), ownerId);
  db.prepare('update auth_users set banned = ? where owner_id = ?').run(disableLogin ? 1 : 0, ownerId);
  serverAudit(ctx.userId, status === 'archived' ? 'owner.archived' : 'owner.status_changed', 'owner', ownerId, {
    from: owner.status,
    to: status,
    login_disabled: disableLogin,
  });
  return { status: 200, json: { ok: true } };
}

function apiDeleteOwner(ctx, body) {
  if (!requireAdminCtx(ctx)) return { status: 403, json: { error: 'Admin access required.' } };
  const ownerId = body.ownerId;
  if (!ownerId) return { status: 400, json: { error: 'ownerId is required.' } };
  const owner = db.prepare('select * from owners where id = ?').get(ownerId);
  if (!owner) return { status: 404, json: { error: 'Owner not found.' } };
  const jobs = db.prepare('select id from jobs where owner_id = ?').all(ownerId);
  for (const j of jobs) {
    db.prepare('delete from jobs where id = ?').run(j.id);
  }
  db.prepare('delete from costs where owner_id = ?').run(ownerId);
  db.prepare('delete from owners where id = ?').run(ownerId);
  db.prepare('delete from auth_users where owner_id = ?').run(ownerId);
  if (owner.auth_user_id) {
    db.prepare('delete from auth_users where id = ?').run(owner.auth_user_id);
  }
  serverAudit(ctx.userId, 'owner.deleted', 'owner', ownerId, {
    username: owner.username,
    display_name: owner.display_name,
    jobs_deleted: jobs.length,
  });
  return { status: 200, json: { ok: true } };
}

function apiOwnerLogin(body) {
  const username = String(body.username || '').toLowerCase().trim();
  const { password } = body;
  if (!username || !password) return { status: 400, json: { error: 'Username and password are required.' } };
  const auth = db.prepare('select * from auth_users where username = ? and role = ?').get(username, 'owner');
  if (!auth || auth.banned || !verifyPassword(password, auth.password_hash)) {
    return { status: 401, json: { error: 'Invalid username or password.' } };
  }
  const session = sessionForUser(auth);
  return { status: 200, json: { access_token: session.access_token, refresh_token: session.refresh_token } };
}

function authPassword(body) {
  const email = String(body.email || '').toLowerCase().trim();
  const { password } = body;
  const auth = db.prepare('select * from auth_users where email = ?').get(email);
  if (!auth || auth.banned || !verifyPassword(password, auth.password_hash)) {
    return { status: 400, json: { error: 'Invalid email or password.' } };
  }
  const session = sessionForUser(auth);
  return { status: 200, json: { session, user: session.user } };
}

function serverAudit(actorUserId, action, entityType, entityId, metadata) {
  try {
    insertRow('audit_log', {
      actor_user_id: actorUserId || null,
      action,
      entity_type: entityType,
      entity_id: entityId,
      metadata_json: metadata || {},
    });
  } catch {
    /* best effort */
  }
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${CONFIG.port}`);
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') return send(res, 204, null);
  if (pathname === '/local/health') return send(res, 200, { ok: true });

  let body = {};
  if (req.method === 'POST') {
    try {
      body = await readBody(req);
    } catch {
      return send(res, 400, { error: 'Invalid JSON body.' });
    }
  }
  const ctx = ctxFromReq(req);

  try {
    // Data query protocol
    if (pathname === '/local/query' && req.method === 'POST') {
      const op = body.op || 'select';
      if (op === 'select') return send(res, 200, handleSelect(body, ctx));
      if (op === 'insert') return send(res, 200, handleInsert(body, ctx));
      if (op === 'update') return send(res, 200, handleUpdate(body, ctx));
      if (op === 'delete') return send(res, 200, handleDelete(body, ctx));
      if (op === 'upsert') return send(res, 200, handleUpsert(body, ctx));
      return send(res, 200, { error: { message: `Unknown op: ${op}` } });
    }

    // RPC
    if (pathname === '/local/rpc' && req.method === 'POST') {
      const { fn, args = {} } = body;
      if (fn === 'owner_earned_commissions') {
        return send(res, 200, ownerEarnedCommissions(args.p_owner || null, args.p_year || CONFIG.taxYear, ctx));
      }
      return send(res, 200, { error: { message: `Unknown function: ${fn}` } });
    }

    // Auth
    if (pathname === '/local/auth/password' && req.method === 'POST') {
      const r = authPassword(body);
      return send(res, r.status, r.json);
    }
    if (pathname === '/local/auth/user' && req.method === 'GET') {
      if (ctx.role === 'anon') return send(res, 200, { user: null });
      const auth = db.prepare('select * from auth_users where id = ?').get(ctx.userId);
      if (!auth) return send(res, 200, { user: null });
      return send(res, 200, {
        user: userObject({
          sub: auth.id,
          email: auth.email,
          role: auth.role,
          owner_id: auth.owner_id,
          display_name: auth.display_name,
          username: auth.username,
        }),
      });
    }

    // Privileged /api routes (mirror the Vercel functions)
    if (pathname === '/api/owners/create' && req.method === 'POST') {
      const r = apiCreateOwner(ctx, body);
      return send(res, r.status, r.json);
    }
    if (pathname === '/api/owners/reset-password' && req.method === 'POST') {
      const r = apiResetPassword(ctx, body);
      return send(res, r.status, r.json);
    }
    if (pathname === '/api/owners/set-status' && req.method === 'POST') {
      const r = apiSetStatus(ctx, body);
      return send(res, r.status, r.json);
    }
    if (pathname === '/api/owners/delete' && req.method === 'POST') {
      const r = apiDeleteOwner(ctx, body);
      return send(res, r.status, r.json);
    }
    if (pathname === '/api/owner-login' && req.method === 'POST') {
      const r = apiOwnerLogin(body);
      return send(res, r.status, r.json);
    }

    return send(res, 404, { error: 'Not found' });
  } catch (e) {
    return send(res, 500, { error: e.message || 'Server error' });
  }
});

server.listen(CONFIG.port, () => {
  const owners = db.prepare('select username from owners order by username').all().map((r) => r.username);
  console.log(`\n▸ Local SQLite backend running at http://localhost:${CONFIG.port}`);
  console.log(`  DB file: ${CONFIG.dbFile}`);
  console.log('\n  Sign in at the app (/login):');
  console.log(`    Admin  → ${CONFIG.adminEmail} / ${CONFIG.adminPassword}`);
  for (const u of owners) console.log(`    Owner  → ${u} / ${CONFIG.ownerSeedPassword}`);
  console.log('');
});

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function send(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(obj == null ? '' : JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 2_000_000) reject(new Error('Body too large'));
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}
function nowISO() {
  return new Date().toISOString();
}
function loadEnvFiles() {
  // Merge .env then .env.local (local wins). Shell-exported vars still win overall.
  const fromFiles = {};
  for (const file of ['.env', '.env.local']) {
    const full = path.resolve(process.cwd(), file);
    if (!fs.existsSync(full)) continue;
    for (const line of fs.readFileSync(full, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      fromFiles[k] = v;
    }
  }
  for (const [k, v] of Object.entries(fromFiles)) {
    if (!(k in process.env)) process.env[k] = v;
  }
}

// ---------------------------------------------------------------------------
// Starter cost templates (only while none exist, so edits and deletes stick
// for the rest of the session). Mirrors migration 0008.
// ---------------------------------------------------------------------------
function seedDefaultCostTemplates() {
  const quotes = {
    'Rent + WIFI + VPN': {
      cost_type: 'fixed',
      quoted_amount_cents: 90000,
      actual_amount_cents: 65000,
      allocation_method: 'equal_owner',
      quoted_by_deal: { miki_wohabe: 90000, three_way: 90000, no_middle: 110000 },
      notes: 'Owner-quoted fixed operating charge.',
      internal_notes: 'Internal actual facility spend (Rent + WiFi + VPN).',
    },
    'Worker Wage': {
      cost_type: 'per_job',
      quoted_amount_cents: 40000,
      actual_amount_cents: 20000,
      allocation_method: 'none',
      quoted_by_deal: { miki_wohabe: 40000, three_way: 40000, no_middle: 60000 },
      notes: 'Owner-quoted worker operating charge for this job.',
      internal_notes: 'Internal actual worker wage.',
    },
    'Manager + HR Salary': {
      cost_type: 'per_job',
      quoted_amount_cents: 40000,
      actual_amount_cents: 10000,
      allocation_method: 'none',
      quoted_by_deal: { miki_wohabe: 40000, three_way: 40000, no_middle: 50000 },
      notes: 'Owner-quoted manager / HR charge for this job.',
      internal_notes: 'Internal actual manager + HR allocation.',
    },
    Transportation: {
      cost_type: 'per_job',
      quoted_amount_cents: 10000,
      actual_amount_cents: 5000,
      allocation_method: 'none',
      quoted_by_deal: { miki_wohabe: 10000, three_way: 10000, no_middle: 15000 },
      notes: 'Owner-quoted transportation charge.',
      internal_notes: 'Internal actual transportation.',
    },
    Miscellaneous: {
      cost_type: 'per_job',
      quoted_amount_cents: 5000,
      actual_amount_cents: 5000,
      allocation_method: 'none',
      quoted_by_deal: { miki_wohabe: 5000, three_way: 5000, no_middle: 10000 },
      notes: 'Owner-quoted miscellaneous charge.',
      internal_notes: 'Internal actual miscellaneous.',
    },
  };

  const renamed = db.prepare("select id from cost_templates where name = 'Transportation + Misc'").get();
  if (renamed) {
    db.prepare("update cost_templates set name = 'Transportation' where id = ?").run(renamed.id);
  }

  for (const [name, t] of Object.entries(quotes)) {
    const existing = db.prepare('select id from cost_templates where name = ?').get(name);
    if (existing) {
      db.prepare(
        'update cost_templates set quoted_amount_cents = ?, actual_amount_cents = ?, quoted_by_deal = ?, is_default = 1 where id = ?',
      ).run(t.quoted_amount_cents, t.actual_amount_cents, JSON.stringify(t.quoted_by_deal), existing.id);
      continue;
    }
    if (db.prepare('select count(*) as c from cost_templates').get().c > 0 && !existing) {
      // DB already has templates the user manages — only fill missing sheet lines.
      insertRow('cost_templates', {
        name,
        ...t,
        cadence: 'monthly',
        owner_visible: true,
        is_default: true,
        active: true,
      });
      continue;
    }
    insertRow('cost_templates', {
      name,
      ...t,
      cadence: 'monthly',
      owner_visible: true,
      is_default: true,
      active: true,
    });
  }
}

// ---------------------------------------------------------------------------
// Demo data seed (only when the database is empty)
// ---------------------------------------------------------------------------
function seedDemoIfEmpty() {
  const count = db.prepare('select count(*) as c from owners').get().c;
  if (count > 0) return;

  const ownerA = crypto.randomUUID();
  const ownerB = crypto.randomUUID();
  const authA = crypto.randomUUID();
  const authB = crypto.randomUUID();

  db.prepare(
    'insert into auth_users (id, email, username, password_hash, role, owner_id, display_name, created_at) values (?,?,?,?,?,?,?,?)',
  ).run(authA, `owner_a@${CONFIG.ownerAuthDomain}`, 'owner_a', hashPassword(CONFIG.ownerSeedPassword), 'owner', ownerA, 'Owner A (Demo)', nowISO());
  db.prepare(
    'insert into auth_users (id, email, username, password_hash, role, owner_id, display_name, created_at) values (?,?,?,?,?,?,?,?)',
  ).run(authB, `owner_b@${CONFIG.ownerAuthDomain}`, 'owner_b', hashPassword(CONFIG.ownerSeedPassword), 'owner', ownerB, 'Owner B (Demo)', nowISO());

  insertRow('owners', { id: ownerA, auth_user_id: authA, username: 'owner_a', display_name: 'Owner A (Demo)', filing_status: 'single', state: 'TX', safety_reserve_rate: 0.12, status: 'active', notes: 'Seed demo owner with 8 jobs.' });
  insertRow('owners', { id: ownerB, auth_user_id: authB, username: 'owner_b', display_name: 'Owner B (Demo)', filing_status: 'single', state: 'TX', safety_reserve_rate: 0.12, status: 'active', notes: 'Seed demo owner referred by Owner A.' });

  const employersA = ['Acme Support Co.', 'Bright Help Inc.', 'CloudCare LLC', 'Delta Desk Corp.', 'Echo Assist Group', 'Foxtrot Service Co.', 'Gamma Care Partners', 'Helio Helpdesk Inc.'];
  const jobIds = [];
  for (const employer of employersA) {
    const j = insertRow('jobs', { owner_id: ownerA, employer_name: employer, role_title: 'Remote Support Agent', annual_salary_cents: 5000000, pay_frequency: 'biweekly', pay_periods_per_year: 26, status: 'active', start_date: '2026-01-05' });
    jobIds.push(j.id);
  }
  const bJobs = [
    { employer_name: 'Nimbus Support Co.', salary: 6200000, role: 'Remote Support Agent' },
    { employer_name: 'Orbit Help LLC', salary: 4800000, role: 'Remote Support Agent' },
    { employer_name: 'Pulse Care Inc.', salary: 7100000, role: 'Senior Support Agent' },
  ];
  for (const b of bJobs) {
    const j = insertRow('jobs', { owner_id: ownerB, employer_name: b.employer_name, role_title: b.role, annual_salary_cents: b.salary, pay_frequency: 'biweekly', pay_periods_per_year: 26, status: 'active', start_date: '2026-02-02' });
    jobIds.push(j.id);
  }

  // Per-job worker cost (actual $700/mo, quoted $1,000/mo) on Owner A's first job.
  const perJob = insertRow('costs', { owner_id: ownerA, job_id: jobIds[0], name: 'Overseas worker operating charge', cost_type: 'per_job', cadence: 'monthly', quoted_amount_cents: 100000, allocation_method: 'none', active: true, owner_visible: true, notes: 'Monthly quoted operating charge for job support.' });
  insertRow('cost_internal_details', { cost_id: perJob.id, actual_amount_cents: 70000, internal_notes: 'Actual overseas worker pay is $700/mo; $300/mo internal margin.' });

  // Fixed rent cost (actual $2,000/mo, quoted $3,000/mo), equal across active jobs.
  const fixed = insertRow('costs', { owner_id: null, job_id: null, name: 'Shared operations facility charge', cost_type: 'fixed', cadence: 'monthly', quoted_amount_cents: 300000, allocation_method: 'equal_all', active: true, owner_visible: true, notes: 'Shared operational charge allocated across active jobs.' });
  insertRow('cost_internal_details', { cost_id: fixed.id, actual_amount_cents: 200000, internal_notes: 'Actual office rent is $2,000/mo.' });
  const activeJobIds = db.prepare("select id from jobs where status='active'").all().map((r) => r.id);
  const pct = Number((100 / activeJobIds.length).toFixed(4));
  for (const jid of activeJobIds) insertRow('cost_allocations', { cost_id: fixed.id, job_id: jid, allocation_percentage: pct });

  // Referral: Owner A refers Owner B at 10% of gross wages.
  insertRow('referrals', { referrer_owner_id: ownerA, referred_owner_id: ownerB, commission_rate: 0.1, commission_basis_type: 'referred_gross_wages', active: true, notes: 'Owner A referred Owner B — 10% of Owner B gross wages.' });

  // Transfer instructions for Owner A.
  insertRow('transfer_instructions', { owner_id: ownerA, job_id: null, label: 'Safety Reserve', destination: 'Reserve savings account', payment_method: 'Internal transfer', amount_type: 'calculated', instructions: 'Move the recommended Safety Reserve amount to your reserve account first.', sort_order: 1, active: true });
  insertRow('transfer_instructions', { owner_id: ownerA, job_id: null, label: 'Operational Charge', destination: 'Operations account', payment_method: 'Internal transfer', amount_type: 'calculated', instructions: 'Transfer quoted operating charges for the pay period.', sort_order: 2, active: true });
  insertRow('transfer_instructions', { owner_id: ownerA, job_id: null, label: 'Remaining Amount', destination: 'Owner primary account', payment_method: 'Internal transfer', amount_type: 'calculated', instructions: 'Keep the remaining amount after reserve and operating charges.', sort_order: 3, active: true });

  // Paycheck schedules: 6 upcoming biweekly dates per active job.
  const start = todayISO();
  for (const jid of activeJobIds) {
    for (const d of generatePayDates(start, 6, 'biweekly')) {
      insertRow('job_paychecks', { job_id: jid, pay_date: d, status: 'scheduled' });
    }
  }

  console.log('  Seeded demo data (2 owners, 11 jobs, costs, referral, schedules).');
}

# YEROME Ledger

A lightweight, secure internal financial & operations dashboard for YEROME's
outsourcing business. It replaces spreadsheets as the source of truth for Owners,
jobs, gross wages, operating costs, internal margin, tax estimates, safety
reserves, referral commissions, and biweekly paycheck planning.

- **Frontend:** React + Vite (JavaScript, plain CSS)
- **Backend:** Supabase (PostgreSQL, Auth, Row Level Security)
- **Privileged server ops:** Vercel serverless functions (`/api`)
- **Hosting:** Vercel

Two roles: a single **YEROME** account (full control, `admin` role in the
database) and read-only **Owners** (see only their own data).

---

## Architecture at a glance

```text
/
  api/                      Vercel serverless functions (service-role, server-only)
    _lib/supabaseAdmin.js   Shared server helpers (auth check, admin client)
    owners/create.js        Create Owner login + record (Admin only)
    owners/reset-password.js Reset an Owner password (Admin only)
    owners/set-status.js    Enable/disable + status (Admin only)
    owner-login.js          Owner username→email sign-in (public)
  src/
    components/             UI primitives, layout, reusable form modals
    context/AuthContext.jsx Session + role (from JWT app_metadata)
    hooks/useAsync.js       Loading/error/empty data hook
    lib/
      calculations/         Pure financial functions (tax, reserve, costs, commission, summary)
      data/                 Reusable Supabase data-layer + financial assembler
      formatting/           Cents/currency + date/pay-schedule helpers
      supabase/client.js    Backend switch: real Supabase client OR local adapter
      supabase/localClient.js  Drop-in adapter for the local SQLite backend (dev)
    pages/admin/            Admin portal pages
    pages/owner/            Owner portal pages
  server/
    localBackend.mjs        Local SQLite dev backend (dev only; not deployed)
  supabase/
    migrations/             Versioned SQL (schema, RLS, functions, tax seed)
    seed.sql                Optional demo data (dev only)
  scripts/                  bootstrap-admin.mjs, seed-dev.mjs
  runAppLocally.sh          One-command local run on SQLite
```

**Money** is always stored and computed as **integer cents**. Rates are decimals
(`0.12` = 12%). All rounding lives in `src/lib/formatting/money.js`.

**Taxes** are computed on an Owner's **combined** projected wages (aggregate →
standard deduction → progressive brackets), then **allocated** to jobs by wage
ratio for reporting. See `src/lib/calculations/tax.js`.

---

## 0. Fastest local run (SQLite, no cloud, no Docker)

Want to try the app immediately without a Supabase account? Use the bundled
SQLite dev backend. **All local settings live in `.env.local`** — nothing you
configure is hardcoded in the scripts.

```bash
# First time: create and edit your local env file
cp .env.local.example .env.local
# Edit ADMIN_EMAIL, ADMIN_PASSWORD, OWNER_SEED_PASSWORD, LOCAL_JWT_SECRET, etc.

./runAppLocally.sh
```

If `.env.local` is missing, the script copies `.env.local.example` for you and
exits so you can edit it first. Prerequisite: **Node 22+** (built-in `node:sqlite`).

Sign in with the credentials you set in `.env.local` (Admin email/password and
`OWNER_SEED_PASSWORD` for seeded owners `owner_a` / `owner_b`).

How it works: `src/lib/supabase/client.js` swaps in a drop-in adapter
(`localClient.js`) when `VITE_BACKEND=local` (from `.env.local`). The adapter
speaks to `server/localBackend.mjs`, which emulates the slice of Supabase the
app uses — auth, the data query protocol, the commission RPC (computed with the
real calc engine), and the privileged `/api/*` routes — backed by the SQLite
file at `LOCAL_DB_FILE`. Delete that file to reset demo data.

> Important: the local backend emulates auth + RLS in application code for
> development convenience. **Production runs on Supabase**, where real PostgreSQL
> RLS enforces the same rules. To deploy, set the `VITE_SUPABASE_*` variables on
> Vercel (see below); do **not** set `VITE_BACKEND` there. The two modes share
> the same frontend code — no changes needed to switch.

---

## 1. Local setup (Supabase)

Prerequisites: **Node 18+** (Node 20+ recommended) and a Supabase project.

```bash
# 1. Install dependencies
npm install

# 2. Create your env file and fill in values (see section 2)
cp .env.example .env

# 3. Apply the database migrations + (optional) seed  (see section 2)

# 4. Bootstrap the Admin user
npm run bootstrap:admin

# 5. Start the dev server
npm run dev
```

Open <http://localhost:5173>.

> The Vite dev server does **not** run the `/api` serverless functions. For
> local testing of Owner creation/login end-to-end, use the Vercel CLI
> (`npm i -g vercel && vercel dev`) which serves both the app and `/api`, or
> deploy to Vercel. All read/write data operations work against Supabase
> directly in `npm run dev`.

Run the calculation test suite anytime:

```bash
npm test
```

---

## 2. Supabase setup

1. **Create a project** at <https://supabase.com>.
2. In **Project Settings → API**, copy:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **anon / publishable key** → `VITE_SUPABASE_PUBLISHABLE_KEY`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (server-only, secret!)
3. **Configure Auth** (Authentication → Providers → Email): keep **Email**
   enabled for password sign-in. **Disable public sign-ups**
   (Authentication → Sign In / Providers → "Allow new users to sign up" = off).
   All accounts are provisioned by the Admin; there is no public signup in the app.
4. **Apply the SQL migrations** in order. Easiest path — open the Supabase
   **SQL Editor** and run each file's contents in order:
   1. `supabase/migrations/0001_init.sql`
   2. `supabase/migrations/0002_seed_tax_year_2026.sql`
   3. `supabase/migrations/0003_financial_functions.sql`
   4. `supabase/migrations/0004_job_paychecks.sql`
   5. `supabase/migrations/0005_taxable_equals_gross.sql`
   6. `supabase/migrations/0006_reserve_after_tax_and_commission_net.sql`
   7. `supabase/migrations/0007_deal_structure.sql`
   8. `supabase/migrations/0008_cost_templates.sql`
   9. `supabase/migrations/0009_three_partnerships.sql`

   Or, with the [Supabase CLI](https://supabase.com/docs/guides/cli):

   ```bash
   supabase link --project-ref <your-ref>
   supabase db push          # applies supabase/migrations/*
   ```

5. **(Optional) Demo data** — run `supabase/seed.sql` in the SQL Editor, then
   attach working demo Owner logins:

   ```bash
   npm run seed:dev
   # prints:  owner_a / ownerpass123   and   owner_b / ownerpass123
   ```

   Do **not** run seed data in production.

### Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Frontend + server | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Frontend + server | Anon/publishable key (safe to expose; protected by RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only** | Bypasses RLS — used only by `/api` + local scripts. Never expose. |
| `ADMIN_EMAIL` | Server only | The single email allowed to be Admin |
| `OWNER_AUTH_DOMAIN` | Server only | Domain used to build internal Owner auth emails (e.g. `owners.local`) |
| `ADMIN_PASSWORD` | Local script only | Used once by `bootstrap:admin`; remove afterward |

Never prefix a secret with `VITE_` — anything with that prefix is bundled into
the browser.

---

## 3. Admin bootstrap

There is exactly one Admin, identified by `ADMIN_EMAIL`.

```bash
# Ensure .env has SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL, ADMIN_PASSWORD, and the URL
npm run bootstrap:admin
```

This creates (or updates) the Supabase Auth user for `ADMIN_EMAIL`, sets its
password, and stamps `app_metadata.role = "admin"`. That role claim (set only by
the service role, unforgeable by clients) is what RLS and the API routes use to
recognize the Admin. Sign in at `/login` using the **Admin** tab.

> Tip: remove `ADMIN_PASSWORD` from `.env` after bootstrapping.

**How Owner logins work:** Owners sign in with a **username + password**. The
`/api/owner-login` route maps the username to an internal Supabase email
(`username@OWNER_AUTH_DOMAIN`) — an implementation detail never shown in the UI —
signs in, and returns a session. Owner auth identities carry
`app_metadata.role = "owner"` and `owner_id`, set by the Admin-only create route.

---

## 4. Vercel deployment

1. Push this repository to GitHub.
2. In Vercel, **Import** the GitHub repo. Framework preset: **Vite**
   (build `npm run build`, output `dist`). `vercel.json` already configures the
   SPA rewrite and keeps `/api/*` as serverless functions.
3. Add **Environment Variables** (Project → Settings → Environment Variables):
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (mark **Sensitive**), `ADMIN_EMAIL`, `OWNER_AUTH_DOMAIN`
   - Do **not** set `ADMIN_PASSWORD` in Vercel.
4. **Deploy.** After deploy, verify:
   - The app loads and `/login` works.
   - API functions respond: `/api/owner-login` (POST) returns 400/401 for bad
     input rather than 404, confirming the function deployed.
   - Admin can sign in; creating an Owner (calls `/api/owners/create`) succeeds.

---

## 5. Security model

- **Service-role key is server-only.** It lives in `/api` functions and local
  scripts, never in client code and never behind a `VITE_` variable. The client
  bundle contains only the publishable/anon key.
- **Owner passwords** are handled entirely by Supabase Auth (hashed/verified by
  Supabase). Application tables never store passwords.
- **Row Level Security** is enabled on every table. Owners can only `SELECT`
  their own rows; all writes are Admin-only. An Owner cannot read another Owner's
  jobs/costs/commissions by changing a URL, ID, or crafting a query — Postgres
  rejects it.
- **Internal actual costs** live in a separate Admin-only table
  (`cost_internal_details`) with no Owner policy, so actual costs and margin are
  never reachable by Owners.
- **Privileged auth operations** (create Owner, reset password, enable/disable
  login) run only in `/api` routes that verify the caller is the Admin (JWT role
  **and** `ADMIN_EMAIL`) before using the service role.

See the review checklists at the bottom of the implementation summary.

---

## Key assumptions (v1)

Documented decisions where the PRD left detail open:

- **Cost annualization:** `per_paycheck` cadence is annualized at **26**
  periods (biweekly); `one_time` counts once within the year.
- **Referral commission** is treated as the **referrer's earned income** and is
  shown separately (dashboard card + Commissions page). It does **not**
  automatically reduce the referred Owner's paycheck; add an explicit transfer
  instruction if a deduction is desired. `flat_per_paycheck` annualizes at 26.
- **Fixed-cost allocations** are materialized into `cost_allocations` (percent
  per job) and recomputed automatically when jobs are added/ended and when a
  fixed cost is saved, so both Admin and Owner read one consistent source.
- **Owner "Estimated Remaining"** = gross − estimated taxes − Safety Reserve −
  quoted operating costs (the estimated distributable amount).
- **Paycheck schedule:** the Admin sets the dates each job's paychecks arrive
  (Job detail → *Paycheck schedule* → *Generate schedule* or *Add date*). Each
  dated paycheck drives its cuts (taxes, reserve, costs, remaining). Per-paycheck
  amounts come from the Owner's authoritative **annual** estimate divided by the
  job's `pay_periods_per_year`; the schedule controls *timing*. An optional
  per-date "expected gross" override prorates the cuts for irregular checks, and
  an optional "actual net received" supports reconciliation. Owners see the
  schedule read-only.
- **`amount_value`** on transfer instructions stores integer **cents** for
  `fixed` and a decimal fraction for `percentage`.

---

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview the production build |
| `npm test` | Run the calculation test suite (Node's built-in runner) |
| `npm run bootstrap:admin` | Create/update the Admin auth user (Supabase) |
| `npm run seed:dev` | Attach demo Owner logins + recompute allocations (Supabase) |
| `./runAppLocally.sh` | Run locally on SQLite (no cloud) — backend + Vite together |
| `npm run local:server` | Start only the local SQLite backend |

Tax figures are planning estimates only — not tax advice or payroll calculations.

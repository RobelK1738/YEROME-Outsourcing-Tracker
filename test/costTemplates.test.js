// Cost template helper tests. Run with: npm test
// These cover the pure mapping from a template row onto the rows a cost needs,
// so template → cost behavior is verifiable without a database.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  costFromTemplate,
  defaultTemplateIds,
  quotedCentsForDeal,
  templateMarginCents,
  templatesForMode,
} from '../src/lib/costTemplates.js';

const fixedTemplate = {
  id: 'tpl-fixed',
  name: 'Rent + WIFI + VPN',
  cost_type: 'fixed',
  cadence: 'monthly',
  quoted_amount_cents: 90000,
  actual_amount_cents: 65000,
  allocation_method: 'equal_owner',
  owner_visible: true,
  is_default: true,
  notes: 'Owner-quoted fixed operating charge.',
  internal_notes: 'Actual facility spend.',
};

const perJobTemplate = {
  id: 'tpl-job',
  name: 'Worker Wage',
  cost_type: 'per_job',
  cadence: 'monthly',
  quoted_amount_cents: 40000,
  actual_amount_cents: 20000,
  allocation_method: 'none',
  owner_visible: true,
  is_default: false,
};

test('quoted amount follows the deal package and falls back to the base quoted', () => {
  const tpl = {
    ...perJobTemplate,
    quoted_by_deal: { miki_wohabe: 40000, three_way: 40000, no_middle: 60000 },
  };
  assert.equal(quotedCentsForDeal(tpl, 'miki_wohabe'), 40000);
  assert.equal(quotedCentsForDeal(tpl, 'three_way'), 40000);
  assert.equal(quotedCentsForDeal(tpl, 'no_middle'), 60000);
  assert.equal(quotedCentsForDeal(tpl, 'two_way'), 60000);
  assert.equal(quotedCentsForDeal(perJobTemplate, 'no_middle'), 40000);
  assert.equal(
    costFromTemplate(tpl, { jobId: 'job-9', dealType: 'no_middle' }).cost.quoted_amount_cents,
    60000,
  );
});

test('template margin is quoted minus actual', () => {
  assert.equal(templateMarginCents(fixedTemplate), 25000);
  assert.equal(templateMarginCents(perJobTemplate), 20000);
  assert.equal(templateMarginCents(null), 0);
});

test('a fixed template maps onto an Owner-scoped cost', () => {
  const { cost, internal } = costFromTemplate(fixedTemplate, { ownerId: 'owner-1' });

  assert.equal(cost.owner_id, 'owner-1');
  assert.equal(cost.job_id, null);
  assert.equal(cost.allocation_method, 'equal_owner');
  assert.equal(cost.quoted_amount_cents, 90000);
  assert.equal(cost.name, 'Rent + WIFI + VPN');
  assert.equal(cost.active, true);
  // Actual amounts stay in the YEROME-only internal row.
  assert.equal(internal.actual_amount_cents, 65000);
  assert.equal(cost.actual_amount_cents, undefined);
});

test('a per-job template maps onto a job-scoped cost and never allocates', () => {
  const { cost, internal } = costFromTemplate(perJobTemplate, {
    ownerId: 'owner-1',
    jobId: 'job-9',
  });

  assert.equal(cost.job_id, 'job-9');
  assert.equal(cost.owner_id, null);
  assert.equal(cost.allocation_method, 'none');
  assert.equal(internal.actual_amount_cents, 20000);
});

test('a template requires a scope that matches its type', () => {
  assert.throws(() => costFromTemplate(fixedTemplate, { jobId: 'job-9' }), /pick an Owner/);
  assert.throws(() => costFromTemplate(perJobTemplate, { ownerId: 'owner-1' }), /pick a job/);
  assert.throws(() => costFromTemplate(null, { ownerId: 'owner-1' }), /Pick a cost template/);
});

test('a missing actual amount means no invented margin', () => {
  const { cost, internal } = costFromTemplate(
    { ...perJobTemplate, actual_amount_cents: null },
    { jobId: 'job-9' },
  );
  assert.equal(internal.actual_amount_cents, 0);
  assert.equal(cost.quoted_amount_cents, 40000);
});

test('scope filters templates and preselects only its own defaults', () => {
  const all = [fixedTemplate, perJobTemplate, { ...perJobTemplate, id: 'tpl-job-2', is_default: true }];

  assert.deepEqual(
    templatesForMode(all, 'owner').map((t) => t.id),
    ['tpl-fixed'],
  );
  assert.deepEqual(
    templatesForMode(all, 'job').map((t) => t.id),
    ['tpl-job', 'tpl-job-2'],
  );
  assert.equal(templatesForMode(all, 'all').length, 3);

  assert.deepEqual(defaultTemplateIds(all, 'owner'), ['tpl-fixed']);
  assert.deepEqual(defaultTemplateIds(all, 'job'), ['tpl-job-2']);
  assert.deepEqual(defaultTemplateIds(all, 'all'), ['tpl-fixed', 'tpl-job-2']);
});

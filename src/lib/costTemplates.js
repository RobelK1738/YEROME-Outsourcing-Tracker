// Pure helpers for cost templates. The templates themselves are rows in the
// cost_templates table (managed on the Costs page) — nothing standard is
// hardcoded here, so repricing a package never needs a code change.
//
// A template stores the owner-quoted amount AND the YEROME actual
// amount, both in cents, matching how a cost is stored across `costs` and
// `cost_internal_details`.

import { formatCurrency } from './formatting/money.js';

/** One-line description used in pickers and confirmation summaries. */
export function costTemplateLabel(template) {
  if (!template) return '';
  const kind = template.cost_type === 'fixed' ? 'Fixed' : 'Per-job';
  const quoted = formatCurrency(template.quoted_amount_cents || 0);
  const actual = formatCurrency(template.actual_amount_cents || 0);
  return `${template.name} — quoted ${quoted} / actual ${actual} (${kind}, ${template.cadence})`;
}

/** Parse quoted_by_deal whether it arrived as jsonb or a JSON string. */
export function parseQuotedByDeal(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

/** Quoted amount for a deal type; falls back to the template's base quoted. */
export function quotedCentsForDeal(template, dealType) {
  if (!template) return 0;
  const map = parseQuotedByDeal(template.quoted_by_deal);
  const key = dealType === 'two_way' ? 'no_middle' : dealType;
  if (key && map[key] != null && map[key] !== '') return Math.max(0, Number(map[key]) || 0);
  return Math.max(0, Number(template.quoted_amount_cents) || 0);
}

/** Quoted − actual: what this template contributes to YEROME take-home. */
export function templateMarginCents(template, dealType) {
  if (!template) return 0;
  return quotedCentsForDeal(template, dealType) - (template.actual_amount_cents || 0);
}

/**
 * Which templates a scope can accept: an Owner takes fixed packages, a job
 * takes per-job ones, and the Costs page shows everything.
 */
export function templatesForMode(templates = [], mode = 'all') {
  if (mode === 'owner') return templates.filter((t) => t.cost_type === 'fixed');
  if (mode === 'job') return templates.filter((t) => t.cost_type === 'per_job');
  return templates;
}

/** IDs preselected when assigning, i.e. the templates flagged as defaults. */
export function defaultTemplateIds(templates = [], mode = 'all') {
  return templatesForMode(templates, mode)
    .filter((t) => t.is_default)
    .map((t) => t.id);
}

/**
 * Map a template onto the rows a cost needs, validating that the scope suits
 * the template's type. Returns { cost, internal }; throws with a message meant
 * for the UI. Kept pure so the mapping is unit-testable without a database.
 */
export function costFromTemplate(template, { ownerId = null, jobId = null, dealType = null } = {}) {
  if (!template) throw new Error('Pick a cost template.');
  const isFixed = template.cost_type === 'fixed';
  if (isFixed && !ownerId) throw new Error(`${template.name} is a fixed cost — pick an Owner.`);
  if (!isFixed && !jobId) throw new Error(`${template.name} is a per-job cost — pick a job.`);

  return {
    cost: {
      cost_type: template.cost_type,
      name: template.name,
      cadence: template.cadence,
      quoted_amount_cents: quotedCentsForDeal(template, dealType),
      owner_visible: template.owner_visible !== false,
      active: true,
      notes: template.notes || null,
      job_id: isFixed ? null : jobId,
      owner_id: isFixed ? ownerId : null,
      allocation_method: isFixed ? template.allocation_method || 'equal_owner' : 'none',
    },
    internal: {
      actual_amount_cents: template.actual_amount_cents || 0,
      internal_notes: template.internal_notes || null,
    },
  };
}

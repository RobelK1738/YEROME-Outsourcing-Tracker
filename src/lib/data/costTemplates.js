// Cost template data access.
//
// PRIVACY: a template holds the owner-quoted amount AND the YEROME
// actual amount, so cost_templates is YEROME-only (RLS grants Owners no rows,
// like cost_internal_details). Never read this table from an Owner view.

import { supabase } from '../supabase/client.js';
import { logAudit } from './audit.js';
import { parseQuotedByDeal } from '../costTemplates.js';

/** YEROME: every template, fixed packages first, then alphabetical. */
export async function listCostTemplates({ active = true } = {}) {
  let query = supabase.from('cost_templates').select('*').order('name');
  if (active === true || active === false) query = query.eq('active', active);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data || []).map((row) => ({
    ...row,
    quoted_by_deal: parseQuotedByDeal(row.quoted_by_deal),
  }));
  return rows.sort((a, b) => {
    if (a.cost_type !== b.cost_type) return a.cost_type === 'fixed' ? -1 : 1;
    return String(a.name).localeCompare(String(b.name));
  });
}

export async function createCostTemplate(template) {
  const { data, error } = await supabase.from('cost_templates').insert(template).select().single();
  if (error) throw error;
  await logAudit({
    action: 'cost_template.created',
    entityType: 'cost_template',
    entityId: data.id,
    metadata: {
      name: data.name,
      cost_type: data.cost_type,
      quoted_amount_cents: data.quoted_amount_cents,
    },
  });
  return data;
}

export async function updateCostTemplate(id, patch) {
  const { data, error } = await supabase
    .from('cost_templates')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  await logAudit({
    action: 'cost_template.changed',
    entityType: 'cost_template',
    entityId: id,
    metadata: { fields: Object.keys(patch || {}) },
  });
  return data;
}

/**
 * Delete a template. Costs already created from it are untouched: a cost copies
 * the amounts at assignment time and does not reference the template.
 */
export async function deleteCostTemplate(id) {
  const { error } = await supabase.from('cost_templates').delete().eq('id', id);
  if (error) throw error;
  await logAudit({ action: 'cost_template.deleted', entityType: 'cost_template', entityId: id });
}

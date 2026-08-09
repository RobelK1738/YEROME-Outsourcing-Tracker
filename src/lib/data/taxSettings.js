// Tax-year settings data access. Everyone signed-in may read (needed for
// calculations); only Admin may modify (enforced by RLS).

import { supabase } from '../supabase/client.js';
import { DEFAULT_TAX_YEAR } from '../constants.js';
import { normalizeSettings } from '../calculations/tax.js';

/** Fetch all tax settings for a year (all filing statuses). */
export async function listTaxSettings(year = DEFAULT_TAX_YEAR) {
  const { data, error } = await supabase
    .from('tax_year_settings')
    .select('*')
    .eq('year', year)
    .order('filing_status');
  if (error) throw error;
  return (data || []).map(normalizeSettings);
}

/** Fetch settings for a specific year + filing status. */
export async function getTaxSettings(filingStatus, year = DEFAULT_TAX_YEAR) {
  const { data, error } = await supabase
    .from('tax_year_settings')
    .select('*')
    .eq('year', year)
    .eq('filing_status', filingStatus)
    .maybeSingle();
  if (error) throw error;
  return data ? normalizeSettings(data) : null;
}

/** Build a { [filingStatus]: settings } map for a year. */
export async function getTaxSettingsMap(year = DEFAULT_TAX_YEAR) {
  const rows = await listTaxSettings(year);
  const map = {};
  for (const row of rows) map[row.filing_status] = row;
  return map;
}

/** Admin-only update of a tax settings row. */
export async function updateTaxSettings(year, filingStatus, patch) {
  const { data, error } = await supabase
    .from('tax_year_settings')
    .update(patch)
    .eq('year', year)
    .eq('filing_status', filingStatus)
    .select()
    .single();
  if (error) throw error;
  return normalizeSettings(data);
}

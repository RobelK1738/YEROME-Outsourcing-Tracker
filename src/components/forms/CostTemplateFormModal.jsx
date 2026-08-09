import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal.jsx';
import { Field, TextInput, Select, TextArea } from '../ui/Field.jsx';
import { createCostTemplate, updateCostTemplate } from '../../lib/data/costTemplates.js';
import { dollarsToCents, centsToDollars, formatCurrency } from '../../lib/formatting/money.js';
import {
  COST_TYPES,
  COST_TYPE_LABELS,
  COST_CADENCES,
  COST_CADENCE_LABELS,
  ALLOCATION_METHODS,
  ALLOCATION_METHOD_LABELS,
  DEAL_TYPE_LABELS,
} from '../../lib/constants.js';
import { parseQuotedByDeal } from '../../lib/costTemplates.js';

function dollarsFromDeal(template, dealType) {
  const map = parseQuotedByDeal(template?.quoted_by_deal);
  const cents = map[dealType] != null ? Number(map[dealType]) : template?.quoted_amount_cents;
  return cents != null && cents !== '' ? String(centsToDollars(cents)) : '';
}

function emptyForm() {
  return {
    name: '',
    cost_type: 'per_job',
    cadence: 'monthly',
    quoted: '',
    quoted_miki: '',
    quoted_three: '',
    quoted_no_middle: '',
    actual: '',
    allocation_method: 'equal_owner',
    owner_visible: true,
    is_default: false,
    active: true,
    notes: '',
    internal_notes: '',
  };
}

function toForm(template) {
  if (!template) return emptyForm();
  return {
    name: template.name || '',
    cost_type: template.cost_type || 'per_job',
    cadence: template.cadence || 'monthly',
    quoted: template.quoted_amount_cents != null ? String(centsToDollars(template.quoted_amount_cents)) : '',
    quoted_miki: dollarsFromDeal(template, 'miki_wohabe'),
    quoted_three: dollarsFromDeal(template, 'three_way'),
    quoted_no_middle: dollarsFromDeal(template, 'no_middle'),
    actual: template.actual_amount_cents != null ? String(centsToDollars(template.actual_amount_cents)) : '',
    allocation_method:
      template.allocation_method || (template.cost_type === 'fixed' ? 'equal_owner' : 'none'),
    owner_visible: template.owner_visible ?? true,
    is_default: template.is_default ?? false,
    active: template.active ?? true,
    notes: template.notes || '',
    internal_notes: template.internal_notes || '',
  };
}

/**
 * Create or edit a reusable cost template. Editing a template does NOT touch
 * costs already assigned from it — those copied their amounts at assign time.
 */
export function CostTemplateFormModal({ open, onClose, onSaved, initial = null }) {
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const editing = Boolean(initial?.id);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!open) return;
    setForm(toForm(initial));
    setError('');
  }, [open, initial]);

  const isFixed = form.cost_type === 'fixed';

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) return setError('Template name is required.');
    const quotedMiki = dollarsToCents(form.quoted_miki || form.quoted);
    const quotedThree = dollarsToCents(form.quoted_three || form.quoted);
    const quotedNoMiddle = dollarsToCents(form.quoted_no_middle || form.quoted);
    const actualCents = form.actual === '' ? 0 : dollarsToCents(form.actual);
    if ([quotedMiki, quotedThree, quotedNoMiddle, actualCents].some((n) => n < 0)) {
      return setError('Amounts cannot be negative.');
    }

    const payload = {
      name: form.name.trim(),
      cost_type: form.cost_type,
      cadence: form.cadence,
      quoted_amount_cents: quotedThree || quotedMiki,
      quoted_by_deal: {
        miki_wohabe: quotedMiki,
        three_way: quotedThree,
        no_middle: quotedNoMiddle,
      },
      actual_amount_cents: actualCents,
      allocation_method: isFixed ? form.allocation_method || 'equal_owner' : 'none',
      owner_visible: Boolean(form.owner_visible),
      is_default: Boolean(form.is_default),
      active: Boolean(form.active),
      notes: form.notes.trim() || null,
      internal_notes: form.internal_notes.trim() || null,
    };

    setSaving(true);
    try {
      if (editing) await updateCostTemplate(initial.id, payload);
      else await createCostTemplate(payload);
      onSaved?.();
      onClose?.();
    } catch (err) {
      const duplicate = /unique|duplicate/i.test(err?.message || '');
      setError(
        duplicate
          ? `A template named “${form.name.trim()}” already exists.`
          : err.message || 'Could not save template.',
      );
    } finally {
      setSaving(false);
    }
  };

  const actualCentsPreview = form.actual === '' ? 0 : dollarsToCents(form.actual);
  const threeWayQuoted = dollarsToCents(form.quoted_three || form.quoted || 0);
  const margin = threeWayQuoted - actualCentsPreview;

  return (
    <Modal
      open={open}
      title={editing ? 'Edit cost template' : 'New cost template'}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn--secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create template'}
          </button>
        </>
      }
    >
      {error ? <div className="form-error">{error}</div> : null}
      <form onSubmit={submit}>
        <p className="muted text-sm" style={{ marginTop: 0 }}>
          Templates are reusable packages you assign to Owners and jobs. Editing one leaves costs
          already assigned from it unchanged.
        </p>

        <div className="form-grid">
          <div className="form-grid--full">
            <Field label="Template name" htmlFor="ct-name" required>
              <TextInput
                id="ct-name"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="e.g. Rent + WIFI + VPN"
                required
              />
            </Field>
          </div>

          <Field
            label="Cost type"
            htmlFor="ct-type"
            required
            hint={isFixed ? 'Assigned to an Owner and split across their jobs.' : 'Assigned to a single job.'}
          >
            <Select
              id="ct-type"
              value={form.cost_type}
              onChange={(e) => {
                const next = e.target.value;
                setForm((f) => ({
                  ...f,
                  cost_type: next,
                  allocation_method: next === 'fixed' ? f.allocation_method || 'equal_owner' : 'none',
                }));
              }}
              options={COST_TYPES.map((t) => ({ value: t, label: COST_TYPE_LABELS[t] }))}
            />
          </Field>
          <Field label="Cadence" htmlFor="ct-cadence" required>
            <Select
              id="ct-cadence"
              value={form.cadence}
              onChange={(e) => set('cadence', e.target.value)}
              options={COST_CADENCES.map((c) => ({ value: c, label: COST_CADENCE_LABELS[c] }))}
            />
          </Field>

          <Field
            label={`${DEAL_TYPE_LABELS.miki_wohabe} quoted ($)`}
            htmlFor="ct-quoted-miki"
            required
            hint="Lower package (same as 3-Way on the sheet)."
          >
            <TextInput
              id="ct-quoted-miki"
              type="number"
              min="0"
              step="0.01"
              value={form.quoted_miki}
              onChange={(e) => set('quoted_miki', e.target.value)}
              required
            />
          </Field>
          <Field
            label={`${DEAL_TYPE_LABELS.three_way} quoted ($)`}
            htmlFor="ct-quoted-three"
            required
            hint={margin != null ? `3-Way margin ${formatCurrency(margin)} to YEROME` : undefined}
          >
            <TextInput
              id="ct-quoted-three"
              type="number"
              min="0"
              step="0.01"
              value={form.quoted_three}
              onChange={(e) => set('quoted_three', e.target.value)}
              required
            />
          </Field>
          <Field
            label={`${DEAL_TYPE_LABELS.no_middle} quoted ($)`}
            htmlFor="ct-quoted-nom"
            required
            hint="Higher package when there is no middle man."
          >
            <TextInput
              id="ct-quoted-nom"
              type="number"
              min="0"
              step="0.01"
              value={form.quoted_no_middle}
              onChange={(e) => set('quoted_no_middle', e.target.value)}
              required
            />
          </Field>
          <Field
            label="Internal actual cost ($)"
            htmlFor="ct-actual"
            hint="YEROME only. Same actuals across all three deals. Never shown to Owners."
          >
            <TextInput
              id="ct-actual"
              type="number"
              min="0"
              step="0.01"
              value={form.actual}
              onChange={(e) => set('actual', e.target.value)}
            />
          </Field>

          {isFixed ? (
            <Field
              label="Allocation"
              htmlFor="ct-alloc"
              hint="How the fixed total is spread across active jobs."
            >
              <Select
                id="ct-alloc"
                value={form.allocation_method}
                onChange={(e) => set('allocation_method', e.target.value)}
                options={ALLOCATION_METHODS.map((m) => ({ value: m, label: ALLOCATION_METHOD_LABELS[m] }))}
              />
            </Field>
          ) : null}

          <Field label="Owner visible" htmlFor="ct-vis">
            <Select
              id="ct-vis"
              value={form.owner_visible ? 'yes' : 'no'}
              onChange={(e) => set('owner_visible', e.target.value === 'yes')}
              options={[
                { value: 'yes', label: 'Visible to Owner' },
                { value: 'no', label: 'Hidden from Owner' },
              ]}
            />
          </Field>
          <Field
            label="Preselect when assigning"
            htmlFor="ct-default"
            hint="Part of the standard package offered for a new Owner or job."
          >
            <Select
              id="ct-default"
              value={form.is_default ? 'yes' : 'no'}
              onChange={(e) => set('is_default', e.target.value === 'yes')}
              options={[
                { value: 'yes', label: 'Yes — preselect' },
                { value: 'no', label: 'No' },
              ]}
            />
          </Field>
          <Field label="Status" htmlFor="ct-active" hint="Inactive templates stay out of the pickers.">
            <Select
              id="ct-active"
              value={form.active ? 'yes' : 'no'}
              onChange={(e) => set('active', e.target.value === 'yes')}
              options={[
                { value: 'yes', label: 'Active' },
                { value: 'no', label: 'Inactive' },
              ]}
            />
          </Field>

          <div className="form-grid--full">
            <Field label="Owner-quoted notes" htmlFor="ct-notes">
              <TextInput id="ct-notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          </div>
          <div className="form-grid--full">
            <Field label="Internal notes (YEROME only)" htmlFor="ct-inotes">
              <TextArea
                id="ct-inotes"
                value={form.internal_notes}
                onChange={(e) => set('internal_notes', e.target.value)}
              />
            </Field>
          </div>
        </div>
      </form>
    </Modal>
  );
}

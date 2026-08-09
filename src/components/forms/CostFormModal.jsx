import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal.jsx';
import { Field, TextInput, Select, TextArea } from '../ui/Field.jsx';
import { createCost, updateCost } from '../../lib/data/costs.js';
import { dollarsToCents, centsToDollars, formatCurrency } from '../../lib/formatting/money.js';
import {
  COST_TYPES,
  COST_TYPE_LABELS,
  COST_CADENCES,
  COST_CADENCE_LABELS,
  ALLOCATION_METHODS,
  ALLOCATION_METHOD_LABELS,
} from '../../lib/constants.js';
import { costTemplateLabel } from '../../lib/costTemplates.js';
import { listCostTemplates } from '../../lib/data/costTemplates.js';

function emptyForm(defaults = {}) {
  return {
    templateId: '',
    cost_type: 'per_job',
    name: '',
    cadence: 'monthly',
    quoted: '',
    actual: '',
    job_id: '',
    owner_id: '',
    allocation_method: 'equal_owner',
    owner_visible: true,
    active: true,
    notes: '',
    internal_notes: '',
    ...defaults,
  };
}

function toForm(cost) {
  if (!cost) return emptyForm();
  return {
    templateId: '',
    cost_type: cost.cost_type,
    name: cost.name || '',
    cadence: cost.cadence || 'monthly',
    quoted: cost.quoted_amount_cents != null ? String(centsToDollars(cost.quoted_amount_cents)) : '',
    actual: cost.internal?.actual_amount_cents != null ? String(centsToDollars(cost.internal.actual_amount_cents)) : '',
    job_id: cost.job_id || '',
    owner_id: cost.owner_id || '',
    allocation_method: cost.allocation_method || (cost.cost_type === 'fixed' ? 'equal_owner' : 'none'),
    owner_visible: cost.owner_visible ?? true,
    active: cost.active ?? true,
    notes: cost.notes || '',
    internal_notes: cost.internal?.internal_notes || '',
  };
}

function formFromTemplate(template, prev = {}) {
  if (!template) return emptyForm({ ...prev, templateId: '' });
  return {
    ...emptyForm(prev),
    templateId: template.id,
    cost_type: template.cost_type,
    name: template.name,
    cadence: template.cadence,
    quoted: String(centsToDollars(template.quoted_amount_cents || 0)),
    actual: String(centsToDollars(template.actual_amount_cents || 0)),
    allocation_method:
      template.cost_type === 'fixed' ? template.allocation_method || 'equal_owner' : 'none',
    owner_visible: template.owner_visible !== false,
    notes: template.notes || '',
    internal_notes: template.internal_notes || '',
    owner_id: prev.owner_id || '',
    job_id: prev.job_id || '',
  };
}

export function CostFormModal({
  open,
  onClose,
  onSaved,
  initial = null,
  owners = [],
  jobs = [],
  defaultOwnerId = '',
  defaultJobId = '',
}) {
  const [form, setForm] = useState(emptyForm());
  const [templates, setTemplates] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const editing = Boolean(initial?.id);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Only the create form offers autofill, so skip the fetch when editing.
  useEffect(() => {
    if (!open || initial?.id) return undefined;
    let cancelled = false;
    listCostTemplates({ active: true })
      .then((rows) => {
        if (!cancelled) setTemplates(rows);
      })
      .catch(() => {
        if (!cancelled) setTemplates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    if (initial?.id) {
      setForm(toForm(initial));
    } else {
      setForm(
        emptyForm({
          owner_id: defaultOwnerId || initial?.owner_id || '',
          job_id: defaultJobId || initial?.job_id || '',
          cost_type: defaultJobId || initial?.job_id ? 'per_job' : defaultOwnerId ? 'fixed' : 'per_job',
          allocation_method: 'equal_owner',
        }),
      );
    }
    setError('');
  }, [open, initial, defaultOwnerId, defaultJobId]);

  const isFixed = form.cost_type === 'fixed';

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) return setError('Cost name is required.');
    const quotedCents = dollarsToCents(form.quoted);
    const actualCents = form.actual === '' ? 0 : dollarsToCents(form.actual);
    if (quotedCents < 0 || actualCents < 0) return setError('Amounts cannot be negative.');
    if (!isFixed && !form.job_id) return setError('Per-job costs must be linked to a job.');
    if (isFixed && form.allocation_method === 'equal_owner' && !form.owner_id) {
      return setError('Pick an Owner — fixed costs like Rent + WiFi + VPN split across that Owner’s jobs.');
    }

    const costPayload = {
      cost_type: form.cost_type,
      name: form.name.trim(),
      cadence: form.cadence,
      quoted_amount_cents: quotedCents,
      owner_visible: Boolean(form.owner_visible),
      active: Boolean(form.active),
      notes: form.notes.trim() || null,
      job_id: isFixed ? null : form.job_id,
      owner_id: isFixed ? form.owner_id || null : null,
      allocation_method: isFixed ? form.allocation_method || 'equal_owner' : 'none',
    };
    const internal = { actual_amount_cents: actualCents, internal_notes: form.internal_notes.trim() || null };

    setSaving(true);
    try {
      if (editing) await updateCost(initial.id, costPayload, internal);
      else await createCost(costPayload, internal);
      onSaved?.();
      onClose?.();
    } catch (err) {
      setError(err.message || 'Could not save cost.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={editing ? 'Edit Cost' : 'New Cost'}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn--secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create cost'}
          </button>
        </>
      }
    >
      {error ? <div className="form-error">{error}</div> : null}
      <form onSubmit={submit}>
        <div className="form-grid">
          {!editing ? (
            <div className="form-grid--full">
              <Field
                label="Cost template"
                htmlFor="c-template"
                hint={
                  templates.length
                    ? 'Autofills owner-quoted + actual amounts. You can still edit before saving.'
                    : 'No templates yet — create one in the Cost templates table on this page.'
                }
              >
                <Select
                  id="c-template"
                  value={form.templateId}
                  onChange={(e) =>
                    setForm((prev) =>
                      formFromTemplate(
                        templates.find((t) => t.id === e.target.value) || null,
                        prev,
                      ),
                    )
                  }
                  placeholder="Custom (blank form)"
                  options={templates.map((t) => ({ value: t.id, label: costTemplateLabel(t) }))}
                />
              </Field>
            </div>
          ) : null}

          <Field label="Cost type" htmlFor="c-type" required>
            <Select
              id="c-type"
              value={form.cost_type}
              onChange={(e) => {
                const next = e.target.value;
                setForm((f) => ({
                  ...f,
                  cost_type: next,
                  templateId: '',
                  allocation_method: next === 'fixed' ? f.allocation_method || 'equal_owner' : 'none',
                }));
              }}
              disabled={editing}
              options={COST_TYPES.map((t) => ({ value: t, label: COST_TYPE_LABELS[t] }))}
            />
          </Field>
          <Field label="Cadence" htmlFor="c-cadence" required>
            <Select
              id="c-cadence"
              value={form.cadence}
              onChange={(e) => set('cadence', e.target.value)}
              options={COST_CADENCES.map((c) => ({ value: c, label: COST_CADENCE_LABELS[c] }))}
            />
          </Field>
          <div className="form-grid--full">
            <Field label="Name" htmlFor="c-name" required>
              <TextInput id="c-name" value={form.name} onChange={(e) => set('name', e.target.value)} required />
            </Field>
          </div>

          {isFixed ? (
            <>
              <Field
                label="Owner"
                htmlFor="c-owner"
                required={form.allocation_method === 'equal_owner'}
                hint="Total fixed cost stays the same for this Owner. Per job / paycheck share shrinks as they add jobs."
              >
                <Select
                  id="c-owner"
                  value={form.owner_id}
                  onChange={(e) => {
                    const ownerId = e.target.value;
                    setForm((f) => ({
                      ...f,
                      owner_id: ownerId,
                      allocation_method:
                        ownerId && (f.allocation_method === 'none' || !f.allocation_method)
                          ? 'equal_owner'
                          : f.allocation_method || 'equal_owner',
                    }));
                  }}
                  placeholder="Select owner"
                  options={owners.map((o) => ({ value: o.id, label: o.display_name }))}
                />
              </Field>
              <Field
                label="How it splits"
                htmlFor="c-alloc"
                hint="Example: Rent + WiFi + VPN stays flat for the Owner; each paycheck carries a smaller slice as jobs grow."
              >
                <Select
                  id="c-alloc"
                  value={form.allocation_method}
                  onChange={(e) => set('allocation_method', e.target.value)}
                  options={ALLOCATION_METHODS.map((m) => ({ value: m, label: ALLOCATION_METHOD_LABELS[m] }))}
                />
              </Field>
            </>
          ) : (
            <div className="form-grid--full">
              <Field label="Job" htmlFor="c-job" required>
                <Select
                  id="c-job"
                  value={form.job_id}
                  onChange={(e) => set('job_id', e.target.value)}
                  placeholder="Select job"
                  options={jobs.map((j) => ({
                    value: j.id,
                    label: `${j.employer_name}${j.owner?.display_name ? ` — ${j.owner.display_name}` : ''}`,
                  }))}
                />
              </Field>
            </div>
          )}

          <Field
            label="Owner-quoted quoted cost ($)"
            htmlFor="c-quoted"
            required
            hint={
              form.quoted !== '' && form.actual !== ''
                ? `Margin ${formatCurrency(dollarsToCents(form.quoted) - dollarsToCents(form.actual))} to YEROME`
                : undefined
            }
          >
            <TextInput id="c-quoted" type="number" min="0" step="0.01" value={form.quoted} onChange={(e) => set('quoted', e.target.value)} required />
          </Field>
          <Field label="Internal actual cost ($)" htmlFor="c-actual" hint="YEROME only. Never shown to Owners.">
            <TextInput id="c-actual" type="number" min="0" step="0.01" value={form.actual} onChange={(e) => set('actual', e.target.value)} />
          </Field>

          <Field label="Owner visible" htmlFor="c-vis">
            <Select
              id="c-vis"
              value={form.owner_visible ? 'yes' : 'no'}
              onChange={(e) => set('owner_visible', e.target.value === 'yes')}
              options={[
                { value: 'yes', label: 'Visible to Owner' },
                { value: 'no', label: 'Hidden from Owner' },
              ]}
            />
          </Field>
          <Field label="Active" htmlFor="c-active">
            <Select
              id="c-active"
              value={form.active ? 'yes' : 'no'}
              onChange={(e) => set('active', e.target.value === 'yes')}
              options={[
                { value: 'yes', label: 'Active' },
                { value: 'no', label: 'Inactive' },
              ]}
            />
          </Field>

          <div className="form-grid--full">
            <Field label="Owner-quoted notes" htmlFor="c-notes">
              <TextInput id="c-notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          </div>
          <div className="form-grid--full">
            <Field label="Internal notes (YEROME only)" htmlFor="c-inotes">
              <TextArea id="c-inotes" value={form.internal_notes} onChange={(e) => set('internal_notes', e.target.value)} />
            </Field>
          </div>
        </div>
      </form>
    </Modal>
  );
}

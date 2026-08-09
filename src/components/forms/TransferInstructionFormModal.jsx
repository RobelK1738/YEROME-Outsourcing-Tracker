import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal.jsx';
import { Field, TextInput, Select, TextArea } from '../ui/Field.jsx';
import { createTransferInstruction, updateTransferInstruction } from '../../lib/data/transfers.js';
import { dollarsToCents, centsToDollars } from '../../lib/formatting/money.js';
import { TRANSFER_AMOUNT_TYPES, TRANSFER_AMOUNT_TYPE_LABELS } from '../../lib/constants.js';

function toForm(inst, ownerId) {
  if (!inst) {
    return {
      job_id: '',
      label: '',
      destination: '',
      payment_method: '',
      amount_type: 'informational',
      amountFixed: '',
      amountPct: '',
      instructions: '',
      sort_order: 0,
      active: true,
    };
  }
  return {
    job_id: inst.job_id || '',
    label: inst.label || '',
    destination: inst.destination || '',
    payment_method: inst.payment_method || '',
    amount_type: inst.amount_type || 'informational',
    amountFixed: inst.amount_type === 'fixed' && inst.amount_value != null ? String(centsToDollars(inst.amount_value)) : '',
    amountPct: inst.amount_type === 'percentage' && inst.amount_value != null ? String(inst.amount_value * 100) : '',
    instructions: inst.instructions || '',
    sort_order: inst.sort_order ?? 0,
    active: inst.active ?? true,
  };
}

export function TransferInstructionFormModal({ open, onClose, onSaved, ownerId, initial = null, jobs = [] }) {
  const [form, setForm] = useState(toForm(initial, ownerId));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const editing = Boolean(initial?.id);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (open) {
      setForm(toForm(initial, ownerId));
      setError('');
    }
  }, [open, initial, ownerId]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.label.trim()) return setError('Label is required.');

    let amount_value = null;
    if (form.amount_type === 'fixed') amount_value = dollarsToCents(form.amountFixed);
    else if (form.amount_type === 'percentage') {
      const pct = Number(form.amountPct);
      if (!(pct >= 0 && pct <= 100)) return setError('Percentage must be 0–100.');
      amount_value = pct / 100;
    }

    const payload = {
      owner_id: ownerId,
      job_id: form.job_id || null,
      label: form.label.trim(),
      destination: form.destination.trim() || null,
      payment_method: form.payment_method.trim() || null,
      amount_type: form.amount_type,
      amount_value,
      instructions: form.instructions.trim() || null,
      sort_order: Number(form.sort_order) || 0,
      active: Boolean(form.active),
    };

    setSaving(true);
    try {
      if (editing) await updateTransferInstruction(initial.id, payload);
      else await createTransferInstruction(payload);
      onSaved?.();
      onClose?.();
    } catch (err) {
      setError(err.message || 'Could not save instruction.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={editing ? 'Edit Transfer Instruction' : 'New Transfer Instruction'}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn--secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add instruction'}
          </button>
        </>
      }
    >
      {error ? <div className="form-error">{error}</div> : null}
      <form onSubmit={submit}>
        <div className="form-grid">
          <div className="form-grid--full">
            <Field label="Label" htmlFor="t-label" required>
              <TextInput id="t-label" value={form.label} onChange={(e) => set('label', e.target.value)} required />
            </Field>
          </div>
          <Field label="Applies to" htmlFor="t-job" hint="Job-level overrides Owner defaults.">
            <Select
              id="t-job"
              value={form.job_id}
              onChange={(e) => set('job_id', e.target.value)}
              placeholder="Owner-level default"
              options={jobs.map((j) => ({ value: j.id, label: j.employer_name }))}
            />
          </Field>
          <Field label="Amount type" htmlFor="t-type">
            <Select
              id="t-type"
              value={form.amount_type}
              onChange={(e) => set('amount_type', e.target.value)}
              options={TRANSFER_AMOUNT_TYPES.map((t) => ({ value: t, label: TRANSFER_AMOUNT_TYPE_LABELS[t] }))}
            />
          </Field>
          {form.amount_type === 'fixed' ? (
            <Field label="Fixed amount ($)" htmlFor="t-fixed">
              <TextInput id="t-fixed" type="number" min="0" step="0.01" value={form.amountFixed} onChange={(e) => set('amountFixed', e.target.value)} />
            </Field>
          ) : null}
          {form.amount_type === 'percentage' ? (
            <Field label="Percentage %" htmlFor="t-pct">
              <TextInput id="t-pct" type="number" min="0" max="100" step="0.5" value={form.amountPct} onChange={(e) => set('amountPct', e.target.value)} />
            </Field>
          ) : null}
          <Field label="Destination" htmlFor="t-dest">
            <TextInput id="t-dest" value={form.destination} onChange={(e) => set('destination', e.target.value)} placeholder="e.g. Reserve savings account" />
          </Field>
          <Field label="Payment method" htmlFor="t-method">
            <TextInput id="t-method" value={form.payment_method} onChange={(e) => set('payment_method', e.target.value)} placeholder="e.g. Internal transfer" />
          </Field>
          <Field label="Display order" htmlFor="t-sort">
            <TextInput id="t-sort" type="number" value={form.sort_order} onChange={(e) => set('sort_order', e.target.value)} />
          </Field>
          <div className="form-grid--full">
            <Field label="Instructions" htmlFor="t-instr">
              <TextArea id="t-instr" value={form.instructions} onChange={(e) => set('instructions', e.target.value)} />
            </Field>
          </div>
        </div>
      </form>
    </Modal>
  );
}

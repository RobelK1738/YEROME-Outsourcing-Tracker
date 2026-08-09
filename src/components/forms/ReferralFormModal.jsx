import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal.jsx';
import { Field, TextInput, Select, TextArea } from '../ui/Field.jsx';
import { createReferral, updateReferral, listReferralJobs } from '../../lib/data/commissions.js';
import { dollarsToCents, centsToDollars } from '../../lib/formatting/money.js';
import { COMMISSION_BASIS_TYPES, COMMISSION_BASIS_LABELS } from '../../lib/constants.js';

function toForm(ref) {
  if (!ref) {
    return {
      referrer_owner_id: '',
      referred_owner_id: '',
      ratePct: '10',
      commission_basis_type: 'referred_distributable',
      flat: '',
      visible_to_referred: false,
      active: true,
      start_date: '',
      end_date: '',
      notes: '',
    };
  }
  return {
    referrer_owner_id: ref.referrer_owner_id,
    referred_owner_id: ref.referred_owner_id,
    ratePct: String((ref.commission_rate ?? 0) * 100),
    commission_basis_type: ref.commission_basis_type,
    flat: ref.flat_amount_cents != null ? String(centsToDollars(ref.flat_amount_cents)) : '',
    visible_to_referred: ref.visible_to_referred ?? false,
    active: ref.active ?? true,
    start_date: ref.start_date || '',
    end_date: ref.end_date || '',
    notes: ref.notes || '',
  };
}

export function ReferralFormModal({ open, onClose, onSaved, initial = null, owners = [], jobs = [] }) {
  const [form, setForm] = useState(toForm(initial));
  const [selectedJobs, setSelectedJobs] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const editing = Boolean(initial?.id);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!open) return;
    setForm(toForm(initial));
    setError('');
    if (initial?.id && initial.commission_basis_type === 'selected_jobs') {
      listReferralJobs(initial.id).then(setSelectedJobs).catch(() => setSelectedJobs([]));
    } else {
      setSelectedJobs([]);
    }
  }, [open, initial]);

  const isFlat = form.commission_basis_type === 'flat_per_paycheck' || form.commission_basis_type === 'custom_manual';
  const isSelected = form.commission_basis_type === 'selected_jobs';

  const referredJobs = jobs.filter((j) => j.owner_id === form.referred_owner_id);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.referrer_owner_id || !form.referred_owner_id) return setError('Select both Owners.');
    if (form.referrer_owner_id === form.referred_owner_id) return setError('An Owner cannot refer themselves.');
    const rate = Number(form.ratePct);
    if (!(rate >= 0)) return setError('Commission rate cannot be negative.');

    const payload = {
      referrer_owner_id: form.referrer_owner_id,
      referred_owner_id: form.referred_owner_id,
      commission_rate: rate / 100,
      commission_basis_type: form.commission_basis_type,
      flat_amount_cents: isFlat ? dollarsToCents(form.flat) : null,
      visible_to_referred: Boolean(form.visible_to_referred),
      active: Boolean(form.active),
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      notes: form.notes.trim() || null,
    };

    setSaving(true);
    try {
      if (editing) await updateReferral(initial.id, payload, isSelected ? selectedJobs : []);
      else await createReferral(payload, isSelected ? selectedJobs : []);
      onSaved?.();
      onClose?.();
    } catch (err) {
      setError(err.message || 'Could not save referral.');
    } finally {
      setSaving(false);
    }
  };

  const toggleJob = (id) =>
    setSelectedJobs((prev) => (prev.includes(id) ? prev.filter((j) => j !== id) : [...prev, id]));

  return (
    <Modal
      open={open}
      title={editing ? 'Edit Referral' : 'New Referral'}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn--secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create referral'}
          </button>
        </>
      }
    >
      {error ? <div className="form-error">{error}</div> : null}
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Referring Owner (earns commission)" htmlFor="r-referrer" required>
            <Select
              id="r-referrer"
              value={form.referrer_owner_id}
              onChange={(e) => set('referrer_owner_id', e.target.value)}
              placeholder="Select Owner"
              options={owners.map((o) => ({ value: o.id, label: o.display_name }))}
            />
          </Field>
          <Field label="Referred Owner" htmlFor="r-referred" required>
            <Select
              id="r-referred"
              value={form.referred_owner_id}
              onChange={(e) => set('referred_owner_id', e.target.value)}
              placeholder="Select Owner"
              options={owners.map((o) => ({ value: o.id, label: o.display_name }))}
            />
          </Field>
          <Field label="Commission rate %" htmlFor="r-rate" hint="Default 10%.">
            <TextInput id="r-rate" type="number" min="0" step="0.5" value={form.ratePct} onChange={(e) => set('ratePct', e.target.value)} />
          </Field>
          <Field label="Commission basis" htmlFor="r-basis" required>
            <Select
              id="r-basis"
              value={form.commission_basis_type}
              onChange={(e) => set('commission_basis_type', e.target.value)}
              options={COMMISSION_BASIS_TYPES.map((t) => ({ value: t, label: COMMISSION_BASIS_LABELS[t] }))}
            />
          </Field>

          {isFlat ? (
            <Field
              label={form.commission_basis_type === 'flat_per_paycheck' ? 'Flat amount per paycheck ($)' : 'Custom annual amount ($)'}
              htmlFor="r-flat"
              required
            >
              <TextInput id="r-flat" type="number" min="0" step="0.01" value={form.flat} onChange={(e) => set('flat', e.target.value)} />
            </Field>
          ) : null}

          <Field label="Visible to referred Owner" htmlFor="r-vis">
            <Select
              id="r-vis"
              value={form.visible_to_referred ? 'yes' : 'no'}
              onChange={(e) => set('visible_to_referred', e.target.value === 'yes')}
              options={[
                { value: 'no', label: 'No (private to referrer)' },
                { value: 'yes', label: 'Yes' },
              ]}
            />
          </Field>
          <Field label="Active" htmlFor="r-active">
            <Select
              id="r-active"
              value={form.active ? 'yes' : 'no'}
              onChange={(e) => set('active', e.target.value === 'yes')}
              options={[
                { value: 'yes', label: 'Active' },
                { value: 'no', label: 'Inactive' },
              ]}
            />
          </Field>
          <Field label="Start date" htmlFor="r-start">
            <TextInput id="r-start" type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} />
          </Field>
          <Field label="End date" htmlFor="r-end">
            <TextInput id="r-end" type="date" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} />
          </Field>

          {isSelected ? (
            <div className="form-grid--full">
              <Field label="Selected jobs (referred Owner)" hint="Commission applies to these jobs' wages.">
                <div className="pill-row">
                  {referredJobs.length === 0 ? (
                    <span className="muted text-sm">Choose a referred Owner with active jobs.</span>
                  ) : (
                    referredJobs.map((j) => (
                      <label key={j.id} className={`badge ${selectedJobs.includes(j.id) ? 'badge--brand' : 'badge--muted'}`} style={{ cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={selectedJobs.includes(j.id)}
                          onChange={() => toggleJob(j.id)}
                          style={{ marginRight: 6 }}
                        />
                        {j.employer_name}
                      </label>
                    ))
                  )}
                </div>
              </Field>
            </div>
          ) : null}

          <div className="form-grid--full">
            <Field label="Notes" htmlFor="r-notes">
              <TextArea id="r-notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          </div>
        </div>
      </form>
    </Modal>
  );
}

import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal.jsx';
import { Field, TextInput, Select, TextArea } from '../ui/Field.jsx';
import { createJob, updateJob } from '../../lib/data/jobs.js';
import { dollarsToCents, centsToDollars } from '../../lib/formatting/money.js';
import {
  JOB_STATUSES,
  JOB_STATUS_LABELS,
  PAY_FREQUENCIES,
  PAY_FREQUENCY_LABELS,
  PAY_PERIODS_BY_FREQUENCY,
} from '../../lib/constants.js';

function toForm(job) {
  if (!job) {
    return {
      owner_id: '',
      employer_name: '',
      role_title: '',
      salary: '',
      pay_frequency: 'biweekly',
      pay_periods_per_year: 26,
      reservePct: '',
      projectedWages: '',
      status: 'active',
      start_date: '',
      end_date: '',
      notes: '',
    };
  }
  return {
    owner_id: job.owner_id,
    employer_name: job.employer_name || '',
    role_title: job.role_title || '',
    salary: job.annual_salary_cents != null ? String(centsToDollars(job.annual_salary_cents)) : '',
    pay_frequency: job.pay_frequency || 'biweekly',
    pay_periods_per_year: job.pay_periods_per_year || 26,
    reservePct: job.safety_reserve_rate != null ? String(job.safety_reserve_rate * 100) : '',
    projectedWages:
      job.projected_tax_year_wages_cents != null
        ? String(centsToDollars(job.projected_tax_year_wages_cents))
        : '',
    status: job.status || 'active',
    start_date: job.start_date || '',
    end_date: job.end_date || '',
    notes: job.notes || '',
  };
}

export function JobFormModal({ open, onClose, onSaved, initial = null, owners = [], lockOwner = false }) {
  const [form, setForm] = useState(toForm(initial));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const editing = Boolean(initial?.id);

  useEffect(() => {
    if (open) {
      setForm(toForm(initial));
      setError('');
    }
  }, [open, initial]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setFrequency = (freq) =>
    setForm((f) => ({ ...f, pay_frequency: freq, pay_periods_per_year: PAY_PERIODS_BY_FREQUENCY[freq] || 26 }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const salaryCents = dollarsToCents(form.salary);
    if (!form.owner_id) return setError('Please select an Owner.');
    if (!form.employer_name.trim()) return setError('Employer name is required.');
    if (salaryCents < 0) return setError('Salary cannot be negative.');
    const periods = Number(form.pay_periods_per_year);
    if (!(periods > 0)) return setError('Pay periods per year must be greater than 0.');
    const reservePct = form.reservePct === '' ? null : Number(form.reservePct);
    if (reservePct != null && !(reservePct >= 0 && reservePct <= 100)) {
      return setError('Safety reserve override must be 0–100%.');
    }

    const payload = {
      owner_id: form.owner_id,
      employer_name: form.employer_name.trim(),
      role_title: form.role_title.trim() || null,
      annual_salary_cents: salaryCents,
      pay_frequency: form.pay_frequency,
      pay_periods_per_year: periods,
      safety_reserve_rate: reservePct != null ? reservePct / 100 : null,
      projected_tax_year_wages_cents:
        form.projectedWages === '' ? null : dollarsToCents(form.projectedWages),
      status: form.status,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      notes: form.notes.trim() || null,
    };

    setSaving(true);
    try {
      if (editing) await updateJob(initial.id, payload);
      else await createJob(payload);
      onSaved?.();
      onClose?.();
    } catch (err) {
      setError(err.message || 'Could not save job.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={editing ? 'Edit Job' : 'New Job'}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn--secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create job'}
          </button>
        </>
      }
    >
      {error ? <div className="form-error">{error}</div> : null}
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Owner" htmlFor="j-owner" required>
            <Select
              id="j-owner"
              value={form.owner_id}
              onChange={(e) => set('owner_id', e.target.value)}
              disabled={lockOwner}
              placeholder="Select Owner"
              options={owners.map((o) => ({ value: o.id, label: o.display_name }))}
            />
          </Field>
          <Field label="Status" htmlFor="j-status">
            <Select
              id="j-status"
              value={form.status}
              onChange={(e) => set('status', e.target.value)}
              options={JOB_STATUSES.map((s) => ({ value: s, label: JOB_STATUS_LABELS[s] }))}
            />
          </Field>
          <Field label="Employer / company" htmlFor="j-emp" required>
            <TextInput id="j-emp" value={form.employer_name} onChange={(e) => set('employer_name', e.target.value)} required />
          </Field>
          <Field label="Role title" htmlFor="j-role">
            <TextInput id="j-role" value={form.role_title} onChange={(e) => set('role_title', e.target.value)} />
          </Field>
          <Field label="Annual gross salary ($)" htmlFor="j-salary" required>
            <TextInput id="j-salary" type="number" min="0" step="0.01" value={form.salary} onChange={(e) => set('salary', e.target.value)} required />
          </Field>
          <Field label="Pay frequency" htmlFor="j-freq">
            <Select
              id="j-freq"
              value={form.pay_frequency}
              onChange={(e) => setFrequency(e.target.value)}
              options={PAY_FREQUENCIES.map((f) => ({ value: f, label: PAY_FREQUENCY_LABELS[f] }))}
            />
          </Field>
          <Field label="Pay periods / year" htmlFor="j-periods">
            <TextInput id="j-periods" type="number" min="1" value={form.pay_periods_per_year} onChange={(e) => set('pay_periods_per_year', e.target.value)} />
          </Field>
          <Field label="Safety reserve override %" htmlFor="j-reserve" hint="Leave blank to use Owner default.">
            <TextInput id="j-reserve" type="number" min="0" max="100" step="0.5" value={form.reservePct} onChange={(e) => set('reservePct', e.target.value)} />
          </Field>
          <Field label="Projected tax-year wages ($)" htmlFor="j-proj" hint="Optional override of salary for tax projection.">
            <TextInput id="j-proj" type="number" min="0" step="0.01" value={form.projectedWages} onChange={(e) => set('projectedWages', e.target.value)} />
          </Field>
          <Field label="Start date" htmlFor="j-start">
            <TextInput id="j-start" type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} />
          </Field>
          <Field label="End date" htmlFor="j-end">
            <TextInput id="j-end" type="date" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} />
          </Field>
          <div className="form-grid--full">
            <Field label="Notes" htmlFor="j-notes">
              <TextArea id="j-notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          </div>
        </div>
      </form>
    </Modal>
  );
}

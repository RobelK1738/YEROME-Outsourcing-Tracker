// Per-job paycheck schedule manager. YEROME sets the dates each paycheck arrives;
// each dated paycheck's cuts (taxes, reserve, costs, remaining) are computed
// from the job's breakdown. Reused in read-only mode for the Owner portal.

import { useEffect, useState } from 'react';
import { useAsync } from '../hooks/useAsync.js';
import {
  listJobPaychecks,
  generateSchedule,
  createJobPaycheck,
  updateJobPaycheck,
  deleteJobPaycheck,
} from '../lib/data/paychecks.js';
import { Card } from './ui/Card.jsx';
import { DataTable } from './ui/DataTable.jsx';
import { Modal } from './ui/Modal.jsx';
import { Field, TextInput, Select } from './ui/Field.jsx';
import { Badge } from './ui/Badge.jsx';
import { Money } from './ui/Money.jsx';
import { Loading } from './ui/Loading.jsx';
import { ErrorState } from './ui/ErrorState.jsx';
import { EmptyState } from './ui/EmptyState.jsx';
import { computeDatedPaycheckPlan } from '../lib/calculations/summary.js';
import { formatDate, todayISO } from '../lib/formatting/dates.js';
import { dollarsToCents, centsToDollars, formatCurrency } from '../lib/formatting/money.js';
import { JOB_PAYCHECK_STATUSES, JOB_PAYCHECK_STATUS_LABELS, PAY_FREQUENCY_LABELS } from '../lib/constants.js';

const STATUS_TONE = { scheduled: 'info', paid: 'ok', skipped: 'muted' };

function planForRow(pc, breakdown) {
  if (!breakdown) {
    return {
      expectedGrossCents: pc.expected_gross_cents ?? null,
      estimatedTaxCents: null,
      safetyReserveCents: null,
      quotedCostsCents: null,
      recommendedRemainingCents: null,
    };
  }
  return computeDatedPaycheckPlan(breakdown, pc.expected_gross_cents);
}

export function PaycheckScheduleManager({ job, breakdown, readOnly = false }) {
  const { data: paychecks, loading, error, refresh } = useAsync(() => listJobPaychecks(job.id), [job.id]);
  const [genOpen, setGenOpen] = useState(false);
  const [editRow, setEditRow] = useState(null);

  const upcoming = (paychecks || []).length;

  return (
    <Card
      title="Paycheck schedule"
      subtitle="Dates this job's paychecks arrive. Each date drives its cuts and taxes."
      actions={
        readOnly ? null : (
          <div className="row">
            <button className="btn btn--secondary btn--sm" onClick={() => setEditRow({})}>
              + Add date
            </button>
            <button className="btn btn--primary btn--sm" onClick={() => setGenOpen(true)}>
              Generate schedule
            </button>
          </div>
        )
      }
      padded={false}
    >
      {loading ? (
        <Loading label="Loading schedule…" />
      ) : error ? (
        <ErrorState error={error} onRetry={refresh} />
      ) : upcoming === 0 ? (
        <EmptyState
          title="No paycheck dates yet"
          message={
            readOnly
              ? 'Your administrator has not set paycheck dates for this job yet.'
              : `Generate a ${PAY_FREQUENCY_LABELS[job.pay_frequency] || 'recurring'} schedule or add dates manually.`
          }
          action={
            readOnly ? null : (
              <button className="btn btn--primary" onClick={() => setGenOpen(true)}>
                Generate schedule
              </button>
            )
          }
        />
      ) : (
        <DataTable
          columns={[
            {
              key: 'date',
              header: 'Pay date',
              mobile: 'title',
              render: (pc) => (
                <>
                  <strong>{formatDate(pc.pay_date)}</strong>
                  {pc.expected_gross_cents != null ? (
                    <span className="badge badge--muted" style={{ marginLeft: 8 }}>custom</span>
                  ) : null}
                </>
              ),
            },
            {
              key: 'gross',
              header: 'Gross',
              mobile: 'meta',
              render: (pc) => {
                const plan = planForRow(pc, breakdown);
                return plan.expectedGrossCents != null ? <Money cents={plan.expectedGrossCents} /> : '—';
              },
              renderMobile: (pc) => {
                const plan = planForRow(pc, breakdown);
                return plan.expectedGrossCents != null ? (
                  <>{'Gross '}<Money cents={plan.expectedGrossCents} /></>
                ) : '—';
              },
            },
            {
              key: 'taxes',
              header: 'Taxes',
              render: (pc) => {
                const plan = planForRow(pc, breakdown);
                return plan.estimatedTaxCents != null ? <Money cents={plan.estimatedTaxCents} /> : '—';
              },
            },
            {
              key: 'reserve',
              header: 'Reserve',
              render: (pc) => {
                const plan = planForRow(pc, breakdown);
                return plan.safetyReserveCents != null ? <Money cents={plan.safetyReserveCents} /> : '—';
              },
            },
            {
              key: 'costs',
              header: 'Costs',
              hideOnMobile: true,
              render: (pc) => {
                const plan = planForRow(pc, breakdown);
                return plan.quotedCostsCents != null ? <Money cents={plan.quotedCostsCents} /> : '—';
              },
            },
            {
              key: 'remaining',
              header: 'Remaining',
              mobile: 'amount',
              render: (pc) => {
                const plan = planForRow(pc, breakdown);
                return plan.recommendedRemainingCents != null ? (
                  <Money cents={plan.recommendedRemainingCents} tone="positive" />
                ) : '—';
              },
            },
            {
              key: 'actual',
              header: 'Actual net',
              hideOnMobile: true,
              render: (pc) =>
                pc.actual_net_received_cents != null ? (
                  <Money cents={pc.actual_net_received_cents} />
                ) : (
                  <span className="muted">—</span>
                ),
            },
            {
              key: 'status',
              header: 'Status',
              mobile: 'badge',
              render: (pc) => (
                <Badge tone={STATUS_TONE[pc.status] || 'muted'}>{JOB_PAYCHECK_STATUS_LABELS[pc.status]}</Badge>
              ),
            },
            ...(readOnly
              ? []
              : [
                  {
                    key: 'actions',
                    header: '',
                    align: 'right',
                    mobile: 'actions',
                    render: (pc) => (
                      <div className="row row--end">
                        <button className="btn btn--secondary btn--sm" onClick={() => setEditRow(pc)}>
                          Edit
                        </button>
                        <button
                          className="btn btn--ghost btn--sm"
                          onClick={async () => {
                            if (confirm(`Remove paycheck on ${formatDate(pc.pay_date)}?`)) {
                              await deleteJobPaycheck(pc.id);
                              refresh();
                            }
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    ),
                  },
                ]),
          ]}
          rows={paychecks}
          mobilePageSize={8}
          emptyTitle="No paycheck dates yet"
        />
      )}

      {!readOnly ? (
        <>
          <GenerateModal
            open={genOpen}
            job={job}
            onClose={() => setGenOpen(false)}
            onSaved={() => {
              setGenOpen(false);
              refresh();
            }}
          />
          <EditPaycheckModal
            open={Boolean(editRow)}
            job={job}
            paycheck={editRow && editRow.id ? editRow : null}
            onClose={() => setEditRow(null)}
            onSaved={() => {
              setEditRow(null);
              refresh();
            }}
          />
        </>
      ) : null}
    </Card>
  );
}

function GenerateModal({ open, job, onClose, onSaved }) {
  const [startDate, setStartDate] = useState(todayISO());
  const [count, setCount] = useState(job.pay_periods_per_year || 26);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setError('');
    if (!startDate) return setError('Choose a first pay date.');
    if (!(Number(count) > 0)) return setError('Number of paychecks must be greater than 0.');
    setSaving(true);
    try {
      const created = await generateSchedule(job, { startDate, count: Number(count) });
      onSaved(created);
    } catch (err) {
      setError(err.message || 'Could not generate schedule.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Generate paycheck schedule"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={submit} disabled={saving}>
            {saving ? 'Generating…' : 'Generate'}
          </button>
        </>
      }
    >
      {error ? <div className="form-error">{error}</div> : null}
      <p className="muted text-sm mb-0">
        Frequency: <strong>{PAY_FREQUENCY_LABELS[job.pay_frequency]}</strong>. Existing dates are kept; only new
        dates are added.
      </p>
      <div className="form-grid mt-16">
        <Field label="First pay date" htmlFor="g-start" required>
          <TextInput id="g-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Field label="Number of paychecks" htmlFor="g-count" required>
          <TextInput id="g-count" type="number" min="1" max="60" value={count} onChange={(e) => setCount(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function EditPaycheckModal({ open, job, paycheck, onClose, onSaved }) {
  const editing = Boolean(paycheck);
  const [form, setForm] = useState({ pay_date: '', status: 'scheduled', expectedGross: '', actualNet: '', notes: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      pay_date: paycheck?.pay_date || todayISO(),
      status: paycheck?.status || 'scheduled',
      expectedGross: paycheck?.expected_gross_cents != null ? String(centsToDollars(paycheck.expected_gross_cents)) : '',
      actualNet: paycheck?.actual_net_received_cents != null ? String(centsToDollars(paycheck.actual_net_received_cents)) : '',
      notes: paycheck?.notes || '',
    });
    setError('');
  }, [open, paycheck?.id]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setError('');
    if (!form.pay_date) return setError('Pay date is required.');
    const payload = {
      job_id: job.id,
      pay_date: form.pay_date,
      status: form.status,
      expected_gross_cents: form.expectedGross === '' ? null : dollarsToCents(form.expectedGross),
      actual_net_received_cents: form.actualNet === '' ? null : dollarsToCents(form.actualNet),
      notes: form.notes.trim() || null,
    };
    setSaving(true);
    try {
      if (editing) await updateJobPaycheck(paycheck.id, payload);
      else await createJobPaycheck(payload);
      onSaved();
    } catch (err) {
      setError(err.message || 'Could not save paycheck.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={editing ? `Edit paycheck — ${formatDate(paycheck.pay_date)}` : 'Add paycheck date'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save' : 'Add'}
          </button>
        </>
      }
    >
      {error ? <div className="form-error">{error}</div> : null}
      <div className="form-grid">
        <Field label="Pay date" htmlFor="p-date" required>
          <TextInput id="p-date" type="date" value={form.pay_date} onChange={(e) => set('pay_date', e.target.value)} />
        </Field>
        <Field label="Status" htmlFor="p-status">
          <Select
            id="p-status"
            value={form.status}
            onChange={(e) => set('status', e.target.value)}
            options={JOB_PAYCHECK_STATUSES.map((s) => ({ value: s, label: JOB_PAYCHECK_STATUS_LABELS[s] }))}
          />
        </Field>
        <Field label="Expected gross override ($)" htmlFor="p-gross" hint="Leave blank to use the standard per-period gross.">
          <TextInput id="p-gross" type="number" min="0" step="0.01" value={form.expectedGross} onChange={(e) => set('expectedGross', e.target.value)} />
        </Field>
        <Field label="Actual net received ($)" htmlFor="p-net" hint="Optional, for reconciliation.">
          <TextInput id="p-net" type="number" min="0" step="0.01" value={form.actualNet} onChange={(e) => set('actualNet', e.target.value)} />
        </Field>
        <div className="form-grid--full">
          <Field label="Notes" htmlFor="p-notes">
            <TextInput id="p-notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </div>
      </div>
      <p className="text-xs muted mt-8">
        Standard per-period gross for this job: {formatCurrency(Math.round((job.annual_salary_cents || 0) / (job.pay_periods_per_year || 26)))}
      </p>
    </Modal>
  );
}

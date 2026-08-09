import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/ui/PageHeader.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { Field, TextInput, Select } from '../../components/ui/Field.jsx';
import { createOwner } from '../../lib/data/adminApi.js';
import { createJob } from '../../lib/data/jobs.js';
import { applyCostTemplates } from '../../lib/data/costs.js';
import { listCostTemplates } from '../../lib/data/costTemplates.js';
import { generateSchedule } from '../../lib/data/paychecks.js';
import {
  DEAL_TYPES,
  DEAL_TYPE_LABELS,
  DEAL_TYPE_HINTS,
  PAY_FREQUENCIES,
  PAY_FREQUENCY_LABELS,
  PAY_PERIODS_BY_FREQUENCY,
} from '../../lib/constants.js';
import { dollarsToCents, formatCurrency } from '../../lib/formatting/money.js';
import { quotedCentsForDeal, templateMarginCents } from '../../lib/costTemplates.js';
import { todayISO } from '../../lib/formatting/dates.js';

const STEPS = ['Owner', 'Job', 'Costs', 'Paychecks'];

export default function SetupOwnerPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [ownerForm, setOwnerForm] = useState({
    displayName: '',
    username: '',
    password: '',
    dealType: 'three_way',
  });
  const [jobForm, setJobForm] = useState({
    employer_name: '',
    role_title: '',
    salary: '50000',
    pay_frequency: 'biweekly',
  });
  const [templates, setTemplates] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [payCount, setPayCount] = useState('26');
  const [startDate, setStartDate] = useState(todayISO());

  const setOwner = (k, v) => setOwnerForm((f) => ({ ...f, [k]: v }));
  const setJob = (k, v) => setJobForm((f) => ({ ...f, [k]: v }));

  const available = useMemo(() => templates.filter((t) => t.active !== false), [templates]);

  const loadTemplates = async () => {
    const rows = await listCostTemplates({ active: true });
    setTemplates(rows);
    setSelectedIds(rows.filter((t) => t.is_default).map((t) => t.id));
  };

  const toggle = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const goNext = async () => {
    setError('');
    if (step === 0) {
      if (!ownerForm.displayName.trim()) return setError('Display name is required.');
      if (!ownerForm.username.trim()) return setError('Username is required.');
      if (!ownerForm.password || ownerForm.password.length < 8) return setError('Password must be at least 8 characters.');
      try {
        await loadTemplates();
      } catch (err) {
        return setError(err.message || 'Could not load cost templates.');
      }
      setStep(1);
      return;
    }
    if (step === 1) {
      if (!jobForm.employer_name.trim()) return setError('Employer name is required.');
      if (dollarsToCents(jobForm.salary) < 0) return setError('Salary cannot be negative.');
      setStep(2);
      return;
    }
    if (step === 2) {
      setStep(3);
    }
  };

  const finish = async () => {
    setError('');
    setSaving(true);
    try {
      const { owner } = await createOwner({
        displayName: ownerForm.displayName.trim(),
        username: ownerForm.username.trim().toLowerCase(),
        password: ownerForm.password,
        filingStatus: 'single',
        dealType: ownerForm.dealType,
        state: 'TX',
        safetyReserveRate: 0.12,
      });
      const job = await createJob({
        owner_id: owner.id,
        employer_name: jobForm.employer_name.trim(),
        role_title: jobForm.role_title.trim() || null,
        annual_salary_cents: dollarsToCents(jobForm.salary),
        pay_frequency: jobForm.pay_frequency,
        pay_periods_per_year: PAY_PERIODS_BY_FREQUENCY[jobForm.pay_frequency] || 26,
        status: 'active',
        start_date: startDate || null,
      });
      const picked = available.filter((t) => selectedIds.includes(t.id));
      if (picked.length) {
        await applyCostTemplates(picked, {
          ownerId: owner.id,
          jobId: job.id,
          dealType: owner.deal_type,
        });
      }
      const count = Number(payCount);
      if (count > 0 && startDate) {
        await generateSchedule(job, { startDate, count });
      }
      navigate(`/admin/owners/${owner.id}`);
    } catch (err) {
      setError(err.message || 'Could not finish setup.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Set up an Owner"
        subtitle="Owner → first job → cost package → paycheck dates. You can edit anything later."
      />

      <ol className="wizard-steps" aria-label="Setup steps">
        {STEPS.map((label, i) => (
          <li key={label} className={`wizard-steps__item ${i === step ? 'is-active' : ''} ${i < step ? 'is-done' : ''}`}>
            <span className="wizard-steps__num">{i + 1}</span>
            <span>{label}</span>
          </li>
        ))}
      </ol>

      {error ? <div className="form-error">{error}</div> : null}

      {step === 0 ? (
        <Card title="Who is this Owner?">
          <div className="form-grid">
            <div className="form-grid--full">
              <Field label="Display name" htmlFor="w-name" required>
                <TextInput id="w-name" value={ownerForm.displayName} onChange={(e) => setOwner('displayName', e.target.value)} required />
              </Field>
            </div>
            <Field label="Username" htmlFor="w-user" hint="They sign in with this." required>
              <TextInput id="w-user" value={ownerForm.username} onChange={(e) => setOwner('username', e.target.value)} required />
            </Field>
            <Field label="Initial password" htmlFor="w-pass" hint="At least 8 characters." required>
              <TextInput id="w-pass" type="text" value={ownerForm.password} onChange={(e) => setOwner('password', e.target.value)} required />
            </Field>
            <div className="form-grid--full">
              <Field label="Partnership" htmlFor="w-deal" hint={DEAL_TYPE_HINTS[ownerForm.dealType]} required>
                <Select
                  id="w-deal"
                  value={ownerForm.dealType}
                  onChange={(e) => setOwner('dealType', e.target.value)}
                  options={DEAL_TYPES.map((d) => ({ value: d, label: DEAL_TYPE_LABELS[d] }))}
                />
              </Field>
            </div>
          </div>
        </Card>
      ) : null}

      {step === 1 ? (
        <Card title="First job" subtitle={`Quoted costs will follow ${DEAL_TYPE_LABELS[ownerForm.dealType]}.`}>
          <div className="form-grid">
            <div className="form-grid--full">
              <Field label="Employer" htmlFor="w-emp" required>
                <TextInput id="w-emp" value={jobForm.employer_name} onChange={(e) => setJob('employer_name', e.target.value)} required />
              </Field>
            </div>
            <Field label="Role" htmlFor="w-role">
              <TextInput id="w-role" value={jobForm.role_title} onChange={(e) => setJob('role_title', e.target.value)} />
            </Field>
            <Field label="Annual salary ($)" htmlFor="w-sal" required>
              <TextInput id="w-sal" type="number" min="0" step="1" value={jobForm.salary} onChange={(e) => setJob('salary', e.target.value)} />
            </Field>
            <Field label="Pay frequency" htmlFor="w-freq">
              <Select
                id="w-freq"
                value={jobForm.pay_frequency}
                onChange={(e) => setJob('pay_frequency', e.target.value)}
                options={PAY_FREQUENCIES.map((f) => ({ value: f, label: PAY_FREQUENCY_LABELS[f] }))}
              />
            </Field>
          </div>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card title="Cost package" subtitle="Defaults match the partnership. Uncheck anything you don't want; amounts can be edited later.">
          <div style={{ display: 'grid', gap: 8 }}>
            {available.map((t) => {
              const quoted = quotedCentsForDeal(t, ownerForm.dealType);
              const checked = selectedIds.includes(t.id);
              return (
                <label key={t.id} className="row" style={{ alignItems: 'flex-start', gap: 10, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8 }}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(t.id)} style={{ marginTop: 3 }} />
                  <span>
                    <strong>{t.name}</strong>
                    <span className="muted text-sm" style={{ display: 'block' }}>
                      {t.cost_type === 'fixed' ? 'Fixed · splits across this Owner’s jobs' : 'Per job'} · {t.cadence}
                    </span>
                    <span className="text-sm" style={{ display: 'block' }}>
                      Quoted {formatCurrency(quoted)} · Actual {formatCurrency(t.actual_amount_cents)} · Margin{' '}
                      {formatCurrency(templateMarginCents(t, ownerForm.dealType))}
                    </span>
                  </span>
                </label>
              );
            })}
            {!available.length ? <p className="muted text-sm">No templates yet. Skip and add costs later from the Costs page.</p> : null}
          </div>
        </Card>
      ) : null}

      {step === 3 ? (
        <Card title="Paycheck dates" subtitle="We’ll generate a schedule from the first pay date. You can add or remove dates later.">
          <div className="form-grid">
            <Field label="First pay date" htmlFor="w-start">
              <TextInput id="w-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="How many paychecks" htmlFor="w-count" hint={jobForm.pay_frequency === 'biweekly' ? '26 ≈ one year' : undefined}>
              <TextInput id="w-count" type="number" min="0" step="1" value={payCount} onChange={(e) => setPayCount(e.target.value)} />
            </Field>
          </div>
          <p className="muted text-sm" style={{ marginBottom: 0 }}>
            Creating {ownerForm.displayName || 'this Owner'} · {jobForm.employer_name || 'first job'} ·{' '}
            {selectedIds.length} cost{selectedIds.length === 1 ? '' : 's'} · {DEAL_TYPE_LABELS[ownerForm.dealType]}
          </p>
        </Card>
      ) : null}

      <div className="row row--between" style={{ marginTop: 16 }}>
        <button
          className="btn btn--secondary"
          onClick={() => (step === 0 ? navigate('/admin/owners') : setStep((s) => s - 1))}
          disabled={saving}
        >
          {step === 0 ? 'Cancel' : 'Back'}
        </button>
        {step < 3 ? (
          <button className="btn btn--primary" onClick={goNext}>
            Continue
          </button>
        ) : (
          <button className="btn btn--primary" onClick={finish} disabled={saving}>
            {saving ? 'Creating…' : 'Create Owner'}
          </button>
        )}
      </div>
    </>
  );
}

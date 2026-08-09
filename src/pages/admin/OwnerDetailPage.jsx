import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAsync } from '../../hooks/useAsync.js';
import { getOwnerFinancials } from '../../lib/data/financials.js';
import { listOwners, updateOwner } from '../../lib/data/owners.js';
import { listReferrals } from '../../lib/data/commissions.js';
import { listCosts } from '../../lib/data/costs.js';
import { listTransferInstructions, deleteTransferInstruction } from '../../lib/data/transfers.js';
import { resetOwnerPassword, deleteOwner } from '../../lib/data/adminApi.js';
import { deleteJob, listJobs } from '../../lib/data/jobs.js';

import { PageHeader } from '../../components/ui/PageHeader.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { StatCard } from '../../components/ui/StatCard.jsx';
import { Tabs } from '../../components/ui/Tabs.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { StatusBadge, Badge } from '../../components/ui/Badge.jsx';
import { Money } from '../../components/ui/Money.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Field, TextInput, Select, TextArea } from '../../components/ui/Field.jsx';
import { Loading } from '../../components/ui/Loading.jsx';
import { ErrorState } from '../../components/ui/ErrorState.jsx';
import { Disclaimer } from '../../components/ui/Disclaimer.jsx';

import { JobFormModal } from '../../components/forms/JobFormModal.jsx';
import { CostFormModal } from '../../components/forms/CostFormModal.jsx';
import { AssignCostTemplatesModal } from '../../components/forms/AssignCostTemplatesModal.jsx';
import { ReferralFormModal } from '../../components/forms/ReferralFormModal.jsx';
import { TransferInstructionFormModal } from '../../components/forms/TransferInstructionFormModal.jsx';

import { computePaycheckRecommendation } from '../../lib/calculations/summary.js';
import { MoneyStory, TaxDetails } from '../../components/ui/MoneyFlow.jsx';
import {
  FILING_STATUSES,
  FILING_STATUS_LABELS,
  OWNER_STATUSES,
  OWNER_STATUS_LABELS,
  DEAL_TYPES,
  DEAL_TYPE_LABELS,
  DEAL_TYPE_HINTS,
  COMMISSION_BASIS_LABELS,
  COST_TYPE_LABELS,
  TRANSFER_AMOUNT_TYPE_LABELS,
} from '../../lib/constants.js';
import {
  formatCurrency,
  formatPercent,
  dollarsToCents,
  centsToDollars,
  annualToMonthly,
} from '../../lib/formatting/money.js';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'costs', label: 'Costs' },
  { id: 'commissions', label: 'Commissions' },
  { id: 'paychecks', label: 'Paychecks' },
  { id: 'transfers', label: 'Transfers' },
];

export default function OwnerDetailPage() {
  const { ownerId } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState('overview');

  const loader = async () => {
    const fin = await getOwnerFinancials(ownerId);
    const [owners, refAsReferrer, refAsReferred, costs, transfers, allJobs] = await Promise.all([
      listOwners(),
      listReferrals({ referrerId: ownerId }),
      listReferrals({ referredId: ownerId }),
      listCosts(),
      listTransferInstructions({ ownerId }),
      listJobs(),
    ]);
    return { fin, owners, refAsReferrer, refAsReferred, costs, transfers, allJobs };
  };
  const { data, loading, error, refresh } = useAsync(loader, [ownerId]);

  const [jobModal, setJobModal] = useState({ open: false, initial: null });
  const [costModal, setCostModal] = useState({ open: false, initial: null });
  const [assignCostsOpen, setAssignCostsOpen] = useState(false);
  const [refModal, setRefModal] = useState({ open: false, initial: null });
  const [tiModal, setTiModal] = useState({ open: false, initial: null });
  const [editOpen, setEditOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);

  const ownerCosts = useMemo(() => {
    if (!data) return [];
    return data.costs.filter(
      (c) => c.job?.owner_id === ownerId || c.owner_id === ownerId,
    );
  }, [data, ownerId]);

  if (loading) return <Loading full label="Loading Owner workspace…" />;
  if (error) return <ErrorState error={error} onRetry={refresh} />;

  const { owner, jobs, financials, earnedCommissions } = data.fin;
  const tax = financials.ownerTax;

  return (
    <>
      <PageHeader
        breadcrumbs={<Link to="/admin/owners">← Owners</Link>}
        title={owner.display_name}
        subtitle={
          <span className="row">
            <span className="mono">@{owner.username}</span> <StatusBadge status={owner.status} kind="owner" />{' '}
            <span className="muted">{FILING_STATUS_LABELS[owner.filing_status]} · {owner.state}</span>
          </span>
        }
        actions={
          <>
            <button className="btn btn--secondary" onClick={() => setEditOpen(true)}>
              Edit
            </button>
            <button className="btn btn--secondary" onClick={() => setPwOpen(true)}>
              Reset password
            </button>
          </>
        }
      />

      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      {tab === 'overview' && (
        <>
          <div className="stat-grid stat-grid--hero">
            <StatCard
              label="Total Annual Gross"
              value={formatCurrency(financials.projectedAnnualWagesCents)}
              emphasis
            />
            <StatCard
              label="Active Commissions"
              value={
                [
                  ...(data.refAsReferrer || []),
                  ...(data.refAsReferred || []),
                ].filter((r) => r.active).length
              }
            />
          </div>

          <MoneyStory
            title="Monthly Money Flow"
            periodLabel="Monthly"
            grossCents={annualToMonthly(financials.projectedAnnualWagesCents)}
            cuts={[
              {
                label: 'Taxes',
                cents: annualToMonthly(tax.totalTaxCents),
                hint: formatPercent(tax.effectiveRate),
              },
              {
                label: 'Owner-quoted Costs',
                cents: annualToMonthly(financials.quotedCostsAnnualCents),
                hint:
                  financials.actualCostsAnnualCents != null
                    ? `Actual: ${formatCurrency(annualToMonthly(financials.actualCostsAnnualCents))}/mo`
                    : undefined,
              },
            ]}
            netCents={annualToMonthly(financials.netProfitAnnualCents)}
            ownerCutCents={annualToMonthly(financials.ownerCutAnnualCents)}
            commissionCents={annualToMonthly(financials.commissionOutAnnualCents)}
            opsDealShareCents={annualToMonthly(financials.opsDealShareAnnualCents)}
            costMarginCents={annualToMonthly(financials.costMarginAnnualCents)}
            gangCutCents={annualToMonthly(financials.gangCutAnnualCents)}
            opsCutCents={annualToMonthly(financials.opsCutAnnualCents)}
            ownerShareRate={financials.ownerShareRate}
            details={
              <>
                <TaxDetails
                  tax={{
                    federalIncomeTaxCents: annualToMonthly(tax.federalIncomeTaxCents),
                    socialSecurityCents: annualToMonthly(tax.socialSecurityCents),
                    medicareCents: annualToMonthly(tax.medicareCents),
                    additionalMedicareCents: annualToMonthly(tax.additionalMedicareCents),
                    stateTaxCents: annualToMonthly(tax.stateTaxCents),
                    totalTaxCents: annualToMonthly(tax.totalTaxCents),
                  }}
                  stateLabel={owner.state}
                  periodLabel="Monthly"
                  hint="From combined Owner wages (progressive), shown as a monthly equivalent."
                />
                <Disclaimer />
              </>
            }
          />

          <Card title="Profile">
            <dl className="kv">
              <dt>Deal structure</dt>
              <dd>{DEAL_TYPE_LABELS[owner.deal_type] || DEAL_TYPE_LABELS.three_way}</dd>
              <dt>Owner share of net</dt>
              <dd>{formatPercent(financials.ownerShareRate)}</dd>
              <dt>Filing status</dt>
              <dd>{FILING_STATUS_LABELS[owner.filing_status]}</dd>
              <dt>State</dt>
              <dd>{owner.state}</dd>
              <dt>Safety Reserve (from Owner share)</dt>
              <dd>
                {formatPercent(owner.safety_reserve_rate)} → {formatCurrency(financials.reserveAnnualCents)}
              </dd>
              {owner.other_income_adjustment_cents ? (
                <>
                  <dt>Other income adj.</dt>
                  <dd>{formatCurrency(owner.other_income_adjustment_cents)}</dd>
                </>
              ) : null}
            </dl>
            {owner.notes ? <p className="muted text-sm mt-16">{owner.notes}</p> : null}
            <div className="row mt-16">
              <button
                className="btn btn--danger btn--sm"
                onClick={async () => {
                  if (
                    !confirm(
                      `Permanently delete ${owner.display_name}? This removes their jobs, related records, and login. This cannot be undone.`,
                    )
                  ) {
                    return;
                  }
                  try {
                    await deleteOwner(owner.id);
                    navigate('/admin/owners');
                  } catch (e) {
                    alert(e.message || 'Could not delete owner.');
                  }
                }}
              >
                Delete Owner
              </button>
            </div>
          </Card>
        </>
      )}

      {tab === 'jobs' && (
        <Card
            title="Jobs"
          actions={
            <button className="btn btn--primary btn--sm" onClick={() => setJobModal({ open: true, initial: { owner_id: ownerId } })}>
              + Add Job
            </button>
          }
          padded={false}
        >
          <DataTable
            columns={[
              { key: 'employer', header: 'Employer', mobile: 'title', render: (j) => <strong>{j.employer_name}</strong> },
              { key: 'role', header: 'Role', mobile: 'meta', render: (j) => j.role_title || '—' },
              { key: 'salary', header: 'Annual', mobile: 'amount', render: (j) => <Money cents={j.annual_salary_cents} /> },
              { key: 'status', header: 'Status', mobile: 'badge', render: (j) => <StatusBadge status={j.status} /> },
              {
                key: 'actions',
                header: '',
                align: 'right',
                // Phones open the job to edit or delete it.
                hideOnMobile: true,
                render: (j) => (
                  <div className="row row--end" onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn--secondary btn--sm" onClick={() => setJobModal({ open: true, initial: j })}>
                      Edit
                    </button>
                    <button
                      className="btn btn--danger btn--sm"
                      onClick={async () => {
                        if (
                          confirm(
                            `Permanently delete job at ${j.employer_name}? This cannot be undone.`,
                          )
                        ) {
                          await deleteJob(j.id);
                          refresh();
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                ),
              },
            ]}
            rows={jobs}
            onRowClick={(j) => navigate(`/admin/jobs/${j.id}`)}
            emptyTitle="No jobs yet"
            emptyMessage="Add this Owner's first job."
            emptyAction={
              <button className="btn btn--primary" onClick={() => setJobModal({ open: true, initial: { owner_id: ownerId } })}>
                + Add Job
              </button>
            }
          />
        </Card>
      )}

      {tab === 'costs' && (
        <Card
          title="Costs"
          subtitle="Fixed costs split evenly across this Owner’s active jobs — total stays flat; per paycheck shrinks as jobs grow."
          actions={
            <div className="row">
              <button className="btn btn--secondary btn--sm" onClick={() => setAssignCostsOpen(true)}>
                Assign templates
              </button>
              <button
                className="btn btn--primary btn--sm"
                onClick={() => setCostModal({ open: true, initial: { owner_id: ownerId } })}
              >
                + Add Cost
              </button>
            </div>
          }
          padded={false}
        >
          <DataTable
            columns={[
              { key: 'name', header: 'Cost', mobile: 'title', render: (c) => <strong>{c.name}</strong> },
              { key: 'type', header: 'Type', mobile: 'meta', render: (c) => COST_TYPE_LABELS[c.cost_type] },
              { key: 'quoted', header: 'Quoted', mobile: 'amount', render: (c) => <Money cents={c.quoted_amount_cents} /> },
              { key: 'actual', header: 'Actual', render: (c) => (c.internal ? <Money cents={c.internal.actual_amount_cents} /> : '—') },
              {
                key: 'margin',
                header: 'Margin',
                render: (c) =>
                  c.internal ? (
                    <Money cents={c.quoted_amount_cents - c.internal.actual_amount_cents} tone={c.quoted_amount_cents - c.internal.actual_amount_cents >= 0 ? 'positive' : 'negative'} />
                  ) : (
                    '—'
                  ),
              },
              {
                key: 'actions',
                header: '',
                align: 'right',
                mobile: 'actions',
                render: (c) => (
                  <button className="btn btn--secondary btn--sm" onClick={() => setCostModal({ open: true, initial: c })}>
                    Edit
                  </button>
                ),
              },
            ]}
            rows={ownerCosts}
            emptyTitle="No costs for this Owner"
            emptyMessage="Add a per-job worker cost or an Owner-scoped fixed cost."
          />
        </Card>
      )}

      {tab === 'commissions' && (
        <>
          <Card
            title="Commissions earned (as referrer)"
            actions={
              <button
                className="btn btn--primary btn--sm"
                onClick={() =>
                  setRefModal({
                    open: true,
                    initial: {
                      referrer_owner_id: ownerId,
                      commission_basis_type: 'referred_distributable',
                      commission_rate: 0.1,
                    },
                  })
                }
              >
                + New Referral
              </button>
            }
            padded={false}
          >
            <DataTable
              columns={[
                { key: 'referred', header: 'Referred Owner', mobile: 'title', render: (r) => r.referred_display_name },
                {
                  key: 'rate',
                  header: 'Rate',
                  mobile: 'meta',
                  render: (r) => formatPercent(r.commission_rate),
                  renderMobile: (r) => `${formatPercent(r.commission_rate)} rate`,
                },
                { key: 'basis', header: 'Basis', hideOnMobile: true, render: (r) => COMMISSION_BASIS_LABELS[r.commission_basis_type] },
                { key: 'annual', header: 'Annual', mobile: 'amount', render: (r) => <Money cents={r.annual_commission_cents} /> },
                { key: 'monthly', header: 'Monthly', hideOnMobile: true, render: (r) => <Money cents={Math.round(r.annual_commission_cents / 12)} /> },
                { key: 'biweekly', header: 'Biweekly', hideOnMobile: true, render: (r) => <Money cents={Math.round(r.annual_commission_cents / 26)} /> },
              ]}
              rows={earnedCommissions}
              getRowKey={(r) => r.referral_id}
              emptyTitle="No commissions earned"
              emptyMessage="This Owner does not currently refer anyone."
            />
          </Card>

          <Card title="Referral relationships" subtitle="Where this Owner is the referrer or the referred party." padded={false}>
            <DataTable
              columns={[
                { key: 'dir', header: 'Role', mobile: 'title', render: (r) => (r.referrer_owner_id === ownerId ? <Badge tone="brand">Referrer</Badge> : <Badge tone="info">Referred</Badge>) },
                { key: 'rate', header: 'Rate', mobile: 'amount', render: (r) => formatPercent(r.commission_rate) },
                { key: 'basis', header: 'Basis', mobile: 'meta', render: (r) => COMMISSION_BASIS_LABELS[r.commission_basis_type] },
                { key: 'status', header: 'Status', mobile: 'badge', render: (r) => <Badge tone={r.active ? 'ok' : 'muted'}>{r.active ? 'Active' : 'Inactive'}</Badge> },
                {
                  key: 'actions',
                  header: '',
                  align: 'right',
                  mobile: 'actions',
                  render: (r) => (
                    <button className="btn btn--secondary btn--sm" onClick={() => setRefModal({ open: true, initial: r })}>
                      Edit
                    </button>
                  ),
                },
              ]}
              rows={[...data.refAsReferrer, ...data.refAsReferred]}
              emptyTitle="No referral relationships"
            />
          </Card>
        </>
      )}

      {tab === 'paychecks' && (
        <Card title="Biweekly paycheck planning" subtitle="Per active job — allocations, not payroll withholding." padded={false}>
          <DataTable
            columns={[
              { key: 'job', header: 'Job', mobile: 'title', render: (b) => <strong>{b.job.employer_name}</strong> },
              {
                key: 'gross',
                header: 'Gross',
                mobile: 'meta',
                render: (b) => <Money cents={computePaycheckRecommendation(b).expectedGrossCents} />,
                renderMobile: (b) => (
                  <>{'Gross '}<Money cents={computePaycheckRecommendation(b).expectedGrossCents} /></>
                ),
              },
              { key: 'tax', header: 'Taxes', render: (b) => <Money cents={computePaycheckRecommendation(b).estimatedTaxCents} /> },
              { key: 'reserve', header: 'Reserve', render: (b) => <Money cents={computePaycheckRecommendation(b).safetyReserveCents} /> },
              { key: 'costs', header: 'Costs', render: (b) => <Money cents={computePaycheckRecommendation(b).quotedCostsCents} /> },
              { key: 'rem', header: 'Remaining', mobile: 'amount', render: (b) => <Money cents={computePaycheckRecommendation(b).recommendedRemainingCents} tone="positive" /> },
            ]}
            rows={financials.jobBreakdowns}
            getRowKey={(b) => b.job.id}
            emptyTitle="No active jobs"
          />
          <div className="card__body"><Disclaimer /></div>
        </Card>
      )}

      {tab === 'transfers' && (
        <Card
          title="Transfer instructions"
          subtitle="Owner-level defaults and job-level overrides."
          actions={
            <button className="btn btn--primary btn--sm" onClick={() => setTiModal({ open: true, initial: null })}>
              + Add Instruction
            </button>
          }
          padded={false}
        >
          <DataTable
            columns={[
              { key: 'order', header: '#', hideOnMobile: true, render: (t) => t.sort_order },
              {
                key: 'label',
                header: 'Label',
                mobile: 'title',
                render: (t) => <strong>{t.label}</strong>,
                renderMobile: (t) => <strong>{`${t.sort_order}. ${t.label}`}</strong>,
              },
              { key: 'scope', header: 'Scope', mobile: 'meta', render: (t) => (t.job_id ? 'Job-level' : 'Owner default') },
              { key: 'type', header: 'Amount', mobile: 'meta', render: (t) => TRANSFER_AMOUNT_TYPE_LABELS[t.amount_type] },
              { key: 'dest', header: 'Destination', hideOnMobile: true, render: (t) => t.destination || '—' },
              {
                key: 'actions',
                header: '',
                align: 'right',
                mobile: 'actions',
                render: (t) => (
                  <div className="row row--end">
                    <button className="btn btn--secondary btn--sm" onClick={() => setTiModal({ open: true, initial: t })}>
                      Edit
                    </button>
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={async () => {
                        if (confirm(`Remove instruction "${t.label}"?`)) {
                          await deleteTransferInstruction(t.id);
                          refresh();
                        }
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ),
              },
            ]}
            rows={data.transfers}
            emptyTitle="No transfer instructions"
            emptyMessage="Add clear steps for what to do with each paycheck."
          />
        </Card>
      )}

      {/* Modals */}
      <JobFormModal
        open={jobModal.open}
        initial={jobModal.initial}
        owners={data.owners}
        lockOwner
        onClose={() => setJobModal({ open: false, initial: null })}
        onSaved={refresh}
      />
      <CostFormModal
        open={costModal.open}
        initial={costModal.initial}
        owners={data.owners}
        jobs={jobs}
        defaultOwnerId={ownerId}
        onClose={() => setCostModal({ open: false, initial: null })}
        onSaved={refresh}
      />
      <AssignCostTemplatesModal
        open={assignCostsOpen}
        owners={data.owners}
        jobs={jobs}
        defaultOwnerId={ownerId}
        mode="all"
        onClose={() => setAssignCostsOpen(false)}
        onSaved={refresh}
      />
      <ReferralFormModal
        open={refModal.open}
        initial={refModal.initial}
        owners={data.owners}
        jobs={data.allJobs}
        onClose={() => setRefModal({ open: false, initial: null })}
        onSaved={refresh}
      />
      <TransferInstructionFormModal
        open={tiModal.open}
        ownerId={ownerId}
        initial={tiModal.initial}
        jobs={jobs}
        onClose={() => setTiModal({ open: false, initial: null })}
        onSaved={refresh}
      />

      <OwnerEditModal open={editOpen} owner={owner} onClose={() => setEditOpen(false)} onSaved={refresh} />
      <ResetPasswordModal open={pwOpen} owner={owner} onClose={() => setPwOpen(false)} />
    </>
  );
}

function Row({ label, value, total }) {
  return (
    <div className={`breakdown__row ${total ? 'breakdown__row--total' : ''}`}>
      <span className="breakdown__label">{label}</span>
      <span className="breakdown__value">{value}</span>
    </div>
  );
}

function OwnerEditModal({ open, owner, onClose, onSaved }) {
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && owner) {
      setForm({
        display_name: owner.display_name,
        filing_status: owner.filing_status,
        deal_type: owner.deal_type || 'three_way',
        state: owner.state,
        reservePct: String((owner.safety_reserve_rate ?? 0.12) * 100),
        otherIncome: String(centsToDollars(owner.other_income_adjustment_cents)),
        status: owner.status,
        notes: owner.notes || '',
      });
      setError('');
    }
  }, [open, owner]);

  if (!open || !form) return null;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setError('');
    const pct = Number(form.reservePct);
    if (!(pct >= 0 && pct <= 100)) return setError('Safety reserve must be 0–100%.');
    setSaving(true);
    try {
      await updateOwner(owner.id, {
        display_name: form.display_name.trim(),
        filing_status: form.filing_status,
        deal_type: form.deal_type,
        state: form.state.trim() || 'TX',
        safety_reserve_rate: pct / 100,
        other_income_adjustment_cents: dollarsToCents(form.otherIncome || 0),
        status: form.status,
        notes: form.notes.trim() || null,
      });
      onSaved?.();
      onClose?.();
    } catch (err) {
      setError(err.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Edit Owner"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn--secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </>
      }
    >
      {error ? <div className="form-error">{error}</div> : null}
      <div className="form-grid">
        <div className="form-grid--full">
          <Field label="Display name" htmlFor="e-name">
            <TextInput id="e-name" value={form.display_name} onChange={(e) => set('display_name', e.target.value)} />
          </Field>
        </div>
        <Field label="Filing status" htmlFor="e-filing">
          <Select id="e-filing" value={form.filing_status} onChange={(e) => set('filing_status', e.target.value)} options={FILING_STATUSES.map((s) => ({ value: s, label: FILING_STATUS_LABELS[s] }))} />
        </Field>
        <Field label="Deal structure" htmlFor="e-deal" hint={DEAL_TYPE_HINTS[form.deal_type]}>
          <Select
            id="e-deal"
            value={form.deal_type}
            onChange={(e) => set('deal_type', e.target.value)}
            options={DEAL_TYPES.map((s) => ({ value: s, label: DEAL_TYPE_LABELS[s] }))}
          />
        </Field>
        <Field label="State" htmlFor="e-state">
          <TextInput id="e-state" value={form.state} onChange={(e) => set('state', e.target.value)} />
        </Field>
        <Field
          label="Safety reserve % (of Owner share)"
          htmlFor="e-reserve"
          hint="Planning tip only — does not reduce net before the split."
        >
          <TextInput id="e-reserve" type="number" min="0" max="100" step="0.5" value={form.reservePct} onChange={(e) => set('reservePct', e.target.value)} />
        </Field>
        <Field label="Status" htmlFor="e-status">
          <Select id="e-status" value={form.status} onChange={(e) => set('status', e.target.value)} options={OWNER_STATUSES.map((s) => ({ value: s, label: OWNER_STATUS_LABELS[s] }))} />
        </Field>
        <Field label="Other taxable income adj. ($)" htmlFor="e-other" hint="Added on top of gross wages for tax estimates.">
          <TextInput id="e-other" type="number" step="0.01" value={form.otherIncome} onChange={(e) => set('otherIncome', e.target.value)} />
        </Field>
        <div className="form-grid--full">
          <Field label="Notes" htmlFor="e-notes">
            <TextArea id="e-notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function ResetPasswordModal({ open, owner, onClose }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setError('');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    setSaving(true);
    try {
      await resetOwnerPassword(owner.id, password);
      setDone(true);
      setPassword('');
    } catch (err) {
      setError(err.message || 'Could not reset password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={`Reset password — ${owner?.display_name || ''}`}
      onClose={() => {
        setDone(false);
        setError('');
        onClose();
      }}
      footer={
        <>
          <button
            className="btn btn--secondary"
            onClick={() => {
              setDone(false);
              onClose();
            }}
            disabled={saving}
          >
            Close
          </button>
          <button className="btn btn--primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Set password'}
          </button>
        </>
      }
    >
      {error ? <div className="form-error">{error}</div> : null}
      {done ? <div className="form-success">Password updated. Share it securely with the Owner.</div> : null}
      <Field label="New password" htmlFor="pw" hint="At least 8 characters.">
        <TextInput id="pw" type="text" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
    </Modal>
  );
}

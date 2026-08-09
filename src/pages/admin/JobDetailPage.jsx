import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAsync } from '../../hooks/useAsync.js';
import { deleteJob, getJob } from '../../lib/data/jobs.js';
import { getOwnerFinancials } from '../../lib/data/financials.js';
import { listCosts } from '../../lib/data/costs.js';
import { listOwners } from '../../lib/data/owners.js';
import { PageHeader } from '../../components/ui/PageHeader.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { StatusBadge } from '../../components/ui/Badge.jsx';
import { Money } from '../../components/ui/Money.jsx';
import { Loading } from '../../components/ui/Loading.jsx';
import { ErrorState } from '../../components/ui/ErrorState.jsx';
import { Disclaimer } from '../../components/ui/Disclaimer.jsx';
import { MoneyStory, TaxDetails } from '../../components/ui/MoneyFlow.jsx';
import { JobFormModal } from '../../components/forms/JobFormModal.jsx';
import { CostFormModal } from '../../components/forms/CostFormModal.jsx';
import { AssignCostTemplatesModal } from '../../components/forms/AssignCostTemplatesModal.jsx';
import { PaycheckScheduleManager } from '../../components/PaycheckScheduleManager.jsx';
import { computeJobSummary, computePaycheckRecommendation } from '../../lib/calculations/summary.js';
import { formatCurrency, formatPercent } from '../../lib/formatting/money.js';
import { listJobs } from '../../lib/data/jobs.js';

export default function JobDetailPage() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [costModalOpen, setCostModalOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  const loader = async () => {
    const job = await getJob(jobId);
    if (!job) throw new Error('Job not found.');
    const [ownerFin, costs, owners, jobs] = await Promise.all([
      getOwnerFinancials(job.owner_id),
      listCosts({ jobId }),
      listOwners(),
      listJobs(),
    ]);
    const breakdown = ownerFin.financials.jobBreakdowns.find((b) => b.job.id === jobId);
    return { job, ownerFin, breakdown, costs, owners, jobs };
  };
  const { data, loading, error, refresh } = useAsync(loader, [jobId]);

  if (loading) return <Loading full label="Loading job…" />;
  if (error) return <ErrorState error={error} onRetry={refresh} />;

  const { job, ownerFin, breakdown, costs, owners, jobs } = data;
  const owner = ownerFin.owner;
  const fin = ownerFin.financials;
  const isActive = job.status === 'active';
  const summary = breakdown ? computeJobSummary(breakdown) : null;
  const paycheck = breakdown ? computePaycheckRecommendation(breakdown) : null;

  return (
    <>
      <PageHeader
        breadcrumbs={
          <span>
            <Link to="/admin/jobs">← Jobs</Link> ·{' '}
            <Link to={`/admin/owners/${owner.id}`}>{owner.display_name}</Link>
          </span>
        }
        title={job.employer_name}
        subtitle={
          <span className="row">
            {job.role_title || 'Role not set'} <StatusBadge status={job.status} />
            <span className="muted">
              {formatCurrency(job.annual_salary_cents)} / yr · {job.pay_periods_per_year} pay periods
            </span>
          </span>
        }
        actions={
          <div className="row">
            <button className="btn btn--secondary" onClick={() => setEditOpen(true)}>
              Edit job
            </button>
            <button
              className="btn btn--danger"
              onClick={async () => {
                if (
                  !confirm(
                    `Permanently delete job at ${job.employer_name}? This cannot be undone.`,
                  )
                ) {
                  return;
                }
                try {
                  await deleteJob(job.id);
                  navigate(`/admin/owners/${owner.id}`);
                } catch (e) {
                  alert(e.message || 'Could not delete job.');
                }
              }}
            >
              Delete
            </button>
          </div>
        }
      />

      {!isActive ? (
        <Card>
          <p className="muted">
            This job is <StatusBadge status={job.status} /> and is excluded from active calculations.
          </p>
        </Card>
      ) : null}

      {isActive && summary && paycheck ? (
        <MoneyStory
          title="Per paycheck: money flow & profit split"
          subtitle={`After-tax this check ≈ ${formatCurrency(paycheck.afterTaxCents)}. Every figure below is for one paycheck.`}
          periodLabel="Paycheck"
          grossCents={paycheck.expectedGrossCents}
          cuts={[
            {
              label: 'Estimated taxes',
              cents: paycheck.estimatedTaxCents,
              hint: formatPercent(fin.ownerTax.effectiveRate),
            },
            {
              label: 'Owner-quoted costs (quoted)',
              cents: paycheck.quotedCostsCents,
              hint:
                paycheck.actualCostsCents != null
                  ? `Actual: ${formatCurrency(paycheck.actualCostsCents)}`
                  : undefined,
            },
          ]}
          netCents={paycheck.netProfitCents}
          netLabel="Owner-quoted net (this check)"
          splitLabel="Split of this paycheck's net"
          ownerCutCents={paycheck.ownerCutCents}
          commissionCents={paycheck.commissionOutCents}
          opsDealShareCents={paycheck.opsDealShareCents}
          costMarginCents={paycheck.costMarginCents}
          gangCutCents={paycheck.gangCutCents}
          opsCutCents={paycheck.opsCutCents}
          ownerShareRate={fin.ownerShareRate}
          footer={
            <span>
              Recommended Safety Reserve from Owner share:{' '}
              <strong>{formatCurrency(paycheck.safetyReserveCents)}</strong> (
              {formatPercent(summary.reserveRate)} of Owner keep)
            </span>
          }
          details={
            <TaxDetails
              tax={paycheck.taxBreakdown}
              stateLabel={owner.state}
              periodLabel="Paycheck"
              hint="From combined Owner wages (progressive), allocated to this job, then divided by pay periods."
            />
          }
        />
      ) : null}

      <PaycheckScheduleManager job={job} breakdown={breakdown} />

      <Card
        title="Costs on this job"
        subtitle="Quoted (owner-quoted) vs actual — margin goes into YEROME take-home."
        actions={
          <div className="row">
            <button className="btn btn--secondary btn--sm" onClick={() => setAssignOpen(true)}>
              Assign standard package
            </button>
            <button className="btn btn--primary btn--sm" onClick={() => setCostModalOpen(true)}>
              + Add Cost
            </button>
          </div>
        }
        padded={false}
      >
        <DataTable
          columns={[
            { key: 'name', header: 'Cost', mobile: 'title', render: (c) => <strong>{c.name}</strong> },
            { key: 'quoted', header: 'Quoted', mobile: 'amount', render: (c) => <Money cents={c.quoted_amount_cents} /> },
            {
              key: 'actual',
              header: 'Actual',
              render: (c) => (c.internal ? <Money cents={c.internal.actual_amount_cents} /> : '—'),
            },
            {
              key: 'margin',
              header: 'Margin',
              render: (c) => {
                const margin = c.internal != null ? c.quoted_amount_cents - c.internal.actual_amount_cents : null;
                return margin != null ? <Money cents={margin} tone={margin >= 0 ? 'positive' : 'negative'} /> : '—';
              },
            },
          ]}
          rows={costs}
          emptyTitle="No costs attached to this job"
          emptyMessage="Use “Assign standard package” for Worker / Manager / Transport."
        />
        <div className="card__body">
          <Disclaimer />
        </div>
      </Card>

      <JobFormModal
        open={editOpen}
        initial={job}
        owners={owners}
        onClose={() => setEditOpen(false)}
        onSaved={refresh}
      />
      <CostFormModal
        open={costModalOpen}
        owners={owners}
        jobs={jobs || []}
        defaultOwnerId={owner.id}
        defaultJobId={job.id}
        onClose={() => setCostModalOpen(false)}
        onSaved={refresh}
      />
      <AssignCostTemplatesModal
        open={assignOpen}
        owners={owners}
        jobs={jobs || []}
        defaultOwnerId={owner.id}
        defaultJobId={job.id}
        mode="job"
        onClose={() => setAssignOpen(false)}
        onSaved={refresh}
      />
    </>
  );
}

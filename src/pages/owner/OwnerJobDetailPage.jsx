import { Link, useParams } from 'react-router-dom';
import { useAsync } from '../../hooks/useAsync.js';
import { getMyOwnerFinancials } from '../../lib/data/financials.js';
import { listMyTransferInstructions, resolveInstructionsForJob } from '../../lib/data/transfers.js';
import { PageHeader } from '../../components/ui/PageHeader.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { StatCard } from '../../components/ui/StatCard.jsx';
import { StatusBadge } from '../../components/ui/Badge.jsx';
import { Loading } from '../../components/ui/Loading.jsx';
import { ErrorState } from '../../components/ui/ErrorState.jsx';
import { Disclaimer } from '../../components/ui/Disclaimer.jsx';
import { MoneyFlow, TaxDetails } from '../../components/ui/MoneyFlow.jsx';
import { PaycheckScheduleManager } from '../../components/PaycheckScheduleManager.jsx';
import { computeJobSummary, computePaycheckRecommendation } from '../../lib/calculations/summary.js';
import { formatCurrency, formatPercent } from '../../lib/formatting/money.js';

export default function OwnerJobDetailPage() {
  const { jobId } = useParams();

  const loader = async () => {
    const [fin, instructions] = await Promise.all([
      getMyOwnerFinancials(),
      listMyTransferInstructions(),
    ]);
    return { fin, instructions };
  };
  const { data, loading, error, refresh } = useAsync(loader, [jobId]);

  if (loading) return <Loading full label="Loading job…" />;
  if (error) return <ErrorState error={error} onRetry={refresh} />;

  const breakdown = data.fin.financials.jobBreakdowns.find((b) => b.job.id === jobId);
  const job = breakdown?.job || data.fin.jobs.find((j) => j.id === jobId);
  if (!job) return <ErrorState error="This job could not be found." title="Not found" />;

  const owner = data.fin.owner;
  const fin = data.fin.financials;
  const instructions = resolveInstructionsForJob(data.instructions, jobId);

  if (!breakdown) {
    return (
      <>
        <PageHeader
          breadcrumbs={<Link to="/owner/jobs">← My Jobs</Link>}
          title={job.employer_name}
          subtitle={<StatusBadge status={job.status} />}
        />
        <Card>
          <p className="muted">
            This job is <StatusBadge status={job.status} /> and is not included in current active
            calculations.
          </p>
        </Card>
      </>
    );
  }

  const summary = computeJobSummary(breakdown);
  const paycheck = computePaycheckRecommendation(breakdown);

  return (
    <>
      <PageHeader
        breadcrumbs={<Link to="/owner/jobs">← My Jobs</Link>}
        title={job.employer_name}
        subtitle={
          <span className="row">
            {job.role_title || 'Support role'} <StatusBadge status={job.status} />
          </span>
        }
      />

      <div className="stat-grid stat-grid--hero">
        <StatCard
          label="Taxes to set aside"
          value={formatCurrency(paycheck.estimatedTaxCents)}
          hint={formatPercent(fin.ownerTax.effectiveRate)}
        />
        <StatCard
          label="Your keep"
          value={formatCurrency(paycheck.ownerCutCents)}
          tone="positive"
          emphasis
        />
        <StatCard
          label="Suggested reserve"
          value={formatCurrency(paycheck.safetyReserveCents)}
          hint={`${formatPercent(summary.reserveRate)} of your keep`}
        />
      </div>

      <MoneyFlow
        title="When this paycheck arrives"
        subtitle="Set aside taxes and operating charges. What remains after the split is your keep."
        periodLabel="Paycheck"
        grossCents={paycheck.expectedGrossCents}
        cuts={[
          {
            label: 'Estimated taxes',
            cents: paycheck.estimatedTaxCents,
            hint: formatPercent(fin.ownerTax.effectiveRate),
          },
          { label: 'Operating costs', cents: paycheck.quotedCostsCents },
        ]}
        remainingCents={paycheck.ownerCutCents}
        remainingLabel="Your keep"
        footer={
          paycheck.keepAfterReserveCents != null ? (
            <span>
              After suggested reserve:{' '}
              <strong>{formatCurrency(paycheck.keepAfterReserveCents)}</strong>
            </span>
          ) : null
        }
        details={
          <>
            <TaxDetails
              tax={paycheck.taxBreakdown}
              stateLabel={owner.state}
              periodLabel="Paycheck"
              hint="Based on your combined wages across jobs, then allocated to this paycheck."
            />
            <Disclaimer />
          </>
        }
      />

      {instructions.length > 0 ? (
        <Card title="Transfer steps">
          {instructions.map((inst, i) => (
            <div className="instruction-step" key={inst.id}>
              <div className="instruction-step__num">{i + 1}</div>
              <div className="instruction-step__body">
                <div className="instruction-step__label">{inst.label}</div>
                {inst.instructions ? (
                  <div className="instruction-step__meta">{inst.instructions}</div>
                ) : null}
              </div>
              <div className="instruction-step__amount">
                {instructionAmount(inst, paycheck)}
              </div>
            </div>
          ))}
        </Card>
      ) : null}

      <PaycheckScheduleManager job={job} breakdown={breakdown} readOnly />
    </>
  );
}

function instructionAmount(inst, paycheck) {
  if (inst.amount_type === 'fixed' && inst.amount_value != null) {
    return formatCurrency(inst.amount_value);
  }
  if (inst.amount_type === 'percentage' && inst.amount_value != null) {
    return formatCurrency(Math.round(paycheck.expectedGrossCents * Number(inst.amount_value)));
  }
  return 'See note';
}

import { useAsync } from '../../hooks/useAsync.js';
import { getMyOwnerFinancials } from '../../lib/data/financials.js';
import { listMyTransferInstructions } from '../../lib/data/transfers.js';
import { listUpcomingPaychecks } from '../../lib/data/paychecks.js';
import { PageHeader } from '../../components/ui/PageHeader.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { Money } from '../../components/ui/Money.jsx';
import { Loading } from '../../components/ui/Loading.jsx';
import { ErrorState } from '../../components/ui/ErrorState.jsx';
import { Disclaimer } from '../../components/ui/Disclaimer.jsx';
import { MoneyFlow } from '../../components/ui/MoneyFlow.jsx';
import { computePaycheckRecommendation, computeDatedPaycheckPlan } from '../../lib/calculations/summary.js';
import { formatCurrency } from '../../lib/formatting/money.js';
import { formatDate, todayISO } from '../../lib/formatting/dates.js';
import { JOB_PAYCHECK_STATUS_LABELS } from '../../lib/constants.js';

const STATUS_TONE = { scheduled: 'info', paid: 'ok', skipped: 'muted' };

export default function OwnerPaychecksPage() {
  const loader = async () => {
    const [fin, instructions, upcoming] = await Promise.all([
      getMyOwnerFinancials(),
      listMyTransferInstructions(),
      listUpcomingPaychecks({ from: todayISO() }),
    ]);
    return { fin, instructions, upcoming };
  };
  const { data, loading, error, refresh } = useAsync(loader, []);

  if (loading) return <Loading full label="Building your paycheck plan…" />;
  if (error) return <ErrorState error={error} onRetry={refresh} />;

  const fin = data.fin.financials;
  const breakdowns = fin.jobBreakdowns;
  const recs = breakdowns.map((b) => ({ job: b.job, rec: computePaycheckRecommendation(b) }));

  const breakdownByJobId = new Map(breakdowns.map((b) => [b.job.id, b]));
  const upcomingRows = (data.upcoming || []).map((pc) => {
    const breakdown = breakdownByJobId.get(pc.job_id);
    const plan = breakdown ? computeDatedPaycheckPlan(breakdown, pc.expected_gross_cents) : null;
    const job = breakdown?.job || (data.fin.jobs || []).find((j) => j.id === pc.job_id);
    return { pc, plan, job };
  });

  const totals = recs.reduce(
    (acc, { rec }) => {
      acc.gross += rec.expectedGrossCents;
      acc.tax += rec.estimatedTaxCents;
      acc.costs += rec.quotedCostsCents;
      acc.net += rec.netProfitCents;
      acc.keep += rec.ownerCutCents;
      acc.reserve += rec.safetyReserveCents;
      return acc;
    },
    { gross: 0, tax: 0, costs: 0, net: 0, keep: 0, reserve: 0 },
  );

  const ownerInstructions = data.instructions.filter((i) => i.job_id == null);

  return (
    <>
      <PageHeader
        title="Paychecks"
        subtitle="What to do when pay arrives — set aside taxes, cover operating charges, then keep your share."
      />

      <MoneyFlow
        title="Typical paycheck (all jobs)"
        subtitle="Taxes and operating costs come out first. Your keep is your share of what remains."
        periodLabel="Paycheck"
        grossCents={totals.gross}
        cuts={[
          { label: 'Estimated taxes', cents: totals.tax },
          { label: 'Operating costs', cents: totals.costs },
        ]}
        remainingCents={totals.keep}
        remainingLabel="Your keep"
        footer={
          totals.reserve > 0 ? (
            <span>
              Suggested reserve from your keep: <strong>{formatCurrency(totals.reserve)}</strong>
            </span>
          ) : null
        }
      />

      <Card title="Step-by-step">
        {[
          { label: 'Set aside estimated taxes', amount: totals.tax },
          { label: 'Cover operating charges', amount: totals.costs },
          { label: 'Your keep', amount: totals.keep },
          ...(totals.reserve > 0
            ? [{ label: 'Optional: move suggested reserve from your keep', amount: totals.reserve }]
            : []),
        ].map((s, i) => (
          <div className="instruction-step" key={i}>
            <div className="instruction-step__num">{i + 1}</div>
            <div className="instruction-step__body">
              <div className="instruction-step__label">{s.label}</div>
            </div>
            <div className="instruction-step__amount">{formatCurrency(s.amount)}</div>
          </div>
        ))}
      </Card>

      {upcomingRows.length > 0 ? (
        <Card title="Upcoming pay dates" padded={false}>
          <DataTable
            columns={[
              {
                key: 'date',
                header: 'Pay date',
                hideOnMobile: true,
                render: (r) => <strong>{formatDate(r.pc.pay_date)}</strong>,
              },
              {
                key: 'company',
                header: 'Company',
                mobile: 'title',
                render: (r) => r.job?.employer_name || '—',
              },
              {
                key: 'gross',
                header: 'Gross',
                hideOnMobile: true,
                render: (r) => (r.plan ? <Money cents={r.plan.expectedGrossCents} /> : '—'),
              },
              {
                key: 'keep',
                header: 'Your keep',
                mobile: 'amount',
                render: (r) =>
                  r.plan ? <Money cents={r.plan.ownerCutCents} tone="positive" /> : '—',
              },
              {
                key: 'status',
                header: 'Status',
                mobile: 'badge',
                render: (r) => (
                  <Badge tone={STATUS_TONE[r.pc.status] || 'muted'}>
                    {JOB_PAYCHECK_STATUS_LABELS[r.pc.status]}
                  </Badge>
                ),
              },
            ]}
            rows={upcomingRows}
            getRowKey={(r) => r.pc.id}
            mobilePageSize={10}
            mobileGroup={(r) => ({ key: r.pc.pay_date, label: formatDate(r.pc.pay_date) })}
          />
        </Card>
      ) : null}

      {ownerInstructions.length > 0 ? (
        <Card title="Transfer instructions">
          {ownerInstructions.map((inst, i) => (
            <div className="instruction-step" key={inst.id}>
              <div className="instruction-step__num">{i + 1}</div>
              <div className="instruction-step__body">
                <div className="instruction-step__label">{inst.label}</div>
                {inst.instructions ? (
                  <div className="instruction-step__meta">{inst.instructions}</div>
                ) : null}
              </div>
            </div>
          ))}
        </Card>
      ) : null}

      <Disclaimer />
    </>
  );
}

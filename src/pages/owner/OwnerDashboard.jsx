import { useNavigate } from 'react-router-dom';
import { useAsync } from '../../hooks/useAsync.js';
import { getMyOwnerFinancials } from '../../lib/data/financials.js';
import { PageHeader } from '../../components/ui/PageHeader.jsx';
import { StatCard } from '../../components/ui/StatCard.jsx';
import { Loading } from '../../components/ui/Loading.jsx';
import { ErrorState } from '../../components/ui/ErrorState.jsx';
import { Disclaimer } from '../../components/ui/Disclaimer.jsx';
import { JobCard } from '../../components/ui/JobCard.jsx';
import { computePaycheckRecommendation } from '../../lib/calculations/summary.js';
import { formatCurrency } from '../../lib/formatting/money.js';

export default function OwnerDashboard() {
  const navigate = useNavigate();
  const { data, loading, error, refresh } = useAsync(() => getMyOwnerFinancials(), []);

  if (loading) return <Loading full label="Loading your dashboard…" />;
  if (error) return <ErrorState error={error} onRetry={refresh} />;

  const { owner, financials } = data;
  const plans = (financials.jobBreakdowns || []).map((b) => ({
    breakdown: b,
    paycheck: computePaycheckRecommendation(b),
  }));
  const taxSetAside = plans.reduce((s, p) => s + (p.paycheck.estimatedTaxCents || 0), 0);
  const reserve = plans.reduce((s, p) => s + (p.paycheck.safetyReserveCents || 0), 0);

  return (
    <>
      <PageHeader
        title={`Hi, ${owner.display_name}`}
        subtitle="Tap a job for paycheck steps. Figures below are what to set aside on a typical paycheck."
      />

      <div className="stat-grid stat-grid--hero">
        <StatCard
          label="Taxes to set aside"
          value={formatCurrency(taxSetAside)}
          hint="Typical paycheck · across your jobs"
        />
        <StatCard
          label="Suggested reserve"
          value={formatCurrency(reserve)}
          hint="From your keep · planning only"
        />
      </div>

      <div className="job-card-list">
        {plans.map(({ breakdown: b, paycheck }) => (
          <JobCard
            key={b.job.id}
            job={b.job}
            paycheck={paycheck}
            onClick={() => navigate(`/owner/jobs/${b.job.id}`)}
          />
        ))}
        {!plans.length ? (
          <p className="muted">When YEROME adds a job, it will show up here as a card you can tap.</p>
        ) : null}
      </div>

      <Disclaimer />
    </>
  );
}

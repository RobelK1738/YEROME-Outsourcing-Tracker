import { useNavigate } from 'react-router-dom';
import { useAsync } from '../../hooks/useAsync.js';
import { getMyOwnerFinancials } from '../../lib/data/financials.js';
import { listMyJobs } from '../../lib/data/jobs.js';
import { PageHeader } from '../../components/ui/PageHeader.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { StatusBadge } from '../../components/ui/Badge.jsx';
import { Money } from '../../components/ui/Money.jsx';
import { Loading } from '../../components/ui/Loading.jsx';
import { ErrorState } from '../../components/ui/ErrorState.jsx';
import { JobCard } from '../../components/ui/JobCard.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { computePaycheckRecommendation } from '../../lib/calculations/summary.js';
import { ACTIVE_JOB_STATUSES } from '../../lib/constants.js';

export default function OwnerJobsPage() {
  const navigate = useNavigate();
  const loader = async () => {
    const [fin, allJobs] = await Promise.all([getMyOwnerFinancials(), listMyJobs()]);
    return { fin, allJobs };
  };
  const { data, loading, error, refresh } = useAsync(loader, []);

  if (loading) return <Loading full label="Loading your jobs…" />;
  if (error) return <ErrorState error={error} onRetry={refresh} />;

  const breakdownByJob = new Map(data.fin.financials.jobBreakdowns.map((b) => [b.job.id, b]));
  const active = data.allJobs.filter((j) => ACTIVE_JOB_STATUSES.includes(j.status));
  const historical = data.allJobs.filter((j) => !ACTIVE_JOB_STATUSES.includes(j.status));

  return (
    <>
      <PageHeader title="My Jobs" subtitle="Tap a job for paycheck steps, taxes to set aside, and your keep." />

      <div className="job-card-list">
        {active.map((job) => {
          const b = breakdownByJob.get(job.id);
          const paycheck = b ? computePaycheckRecommendation(b) : null;
          return (
            <JobCard
              key={job.id}
              job={job}
              paycheck={paycheck}
              onClick={() => navigate(`/owner/jobs/${job.id}`)}
            />
          );
        })}
        {!active.length ? (
          <p className="muted">When jobs are assigned to you, they will show here.</p>
        ) : null}
      </div>

      {historical.length > 0 ? (
        <Card title="Past jobs" padded={false}>
          <DataTable
            columns={[
              { key: 'employer', header: 'Company', mobile: 'title', render: (j) => j.employer_name },
              { key: 'status', header: 'Status', mobile: 'badge', render: (j) => <StatusBadge status={j.status} /> },
              { key: 'salary', header: 'Salary', mobile: 'amount', render: (j) => <Money cents={j.annual_salary_cents} /> },
            ]}
            rows={historical}
            onRowClick={(j) => navigate(`/owner/jobs/${j.id}`)}
            emptyTitle="No past jobs"
          />
        </Card>
      ) : null}
    </>
  );
}

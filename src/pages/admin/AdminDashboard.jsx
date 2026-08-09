import { useNavigate } from 'react-router-dom';
import { useAsync } from '../../hooks/useAsync.js';
import { getBusinessOverview } from '../../lib/data/financials.js';
import { PageHeader } from '../../components/ui/PageHeader.jsx';
import { StatCard } from '../../components/ui/StatCard.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { Money } from '../../components/ui/Money.jsx';
import { StatusBadge } from '../../components/ui/Badge.jsx';
import { Loading } from '../../components/ui/Loading.jsx';
import { ErrorState } from '../../components/ui/ErrorState.jsx';
import { annualToMonthly, etbFormatCurrency, formatCurrency } from '../../lib/formatting/money.js';
import { DEAL_TYPE_LABELS } from '../../lib/constants.js';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { data, loading, error, refresh } = useAsync(() => getBusinessOverview(), []);

  if (loading) return <Loading full label="Loading business overview…" />;
  if (error) return <ErrorState error={error} onRetry={refresh} />;

  const { totals, ownerSummaries } = data;

  return (
    <>
      <PageHeader
        title="YEROME Dashboard"
        subtitle="Take-home = Gross - Tax − Costs − Owner − Commission − Gang "
        actions={
          <button className="btn btn--primary" onClick={() => navigate('/admin/setup')}>
            Set up Owner
          </button>
        }
      />

      <div className="stat-grid stat-grid--hero">
        <StatCard
          label="Monthly Take-home"
          value={formatCurrency(annualToMonthly(totals.totalOpsCutCents))}
          tone="positive"
          emphasis
          hint={etbFormatCurrency(175 * annualToMonthly(totals.totalOpsCutCents))}
        />
        <StatCard
          label="Active Owners"
          value={totals.activeOwners}
          tone="positive"
          emphasis
          hint={`${totals.activeJobCount} Jobs`}
        />
      </div>

      <Card title="Owners" padded={false}>
        <DataTable
          columns={[
            { key: 'owner', header: 'Owner', mobile: 'title', render: (r) => <strong>{r.owner.display_name}</strong> },
            {
              key: 'deal',
              header: 'Deal',
              hideOnMobile: true,
              render: (r) => DEAL_TYPE_LABELS[r.owner.deal_type] || '—',
            },
            {
              key: 'jobs',
              header: 'Jobs',
              mobile: 'meta',
              render: (r) => r.activeJobCount,
              renderMobile: (r) => `${r.activeJobCount} ${r.activeJobCount === 1 ? 'job' : 'jobs'}`,
            },
            {
              key: 'gross',
              header: 'Gross',
              render: (r) => <Money cents={r.projectedAnnualWagesCents} />,
            },
            {
              key: 'net',
              header: 'Net profit',
              render: (r) => <Money cents={r.netProfitAnnualCents} />,
            },
            {
              key: 'ownerCut',
              header: 'Owner share',
              hideOnMobile: true,
              render: (r) => <Money cents={r.ownerCutAnnualCents} />,
            },
            {
              key: 'mm',
              header: 'Middle man',
              hideOnMobile: true,
              render: (r) =>
                r.commissionOutAnnualCents > 0 ? (
                  <Money cents={r.commissionOutAnnualCents} />
                ) : (
                  '—'
                ),
            },
            {
              key: 'ops',
              header: 'YEROME take-home',
              mobile: 'amount',
              render: (r) => <Money cents={r.opsCutAnnualCents} tone="positive" />,
            },
            {
              key: 'status',
              header: 'Status',
              mobile: 'badge',
              render: (r) => <StatusBadge status={r.owner.status} kind="owner" />,
            },
          ]}
          rows={ownerSummaries}
          getRowKey={(r) => r.owner.id}
          onRowClick={(r) => navigate(`/admin/owners/${r.owner.id}`)}
          emptyTitle="No owners yet"
          emptyMessage="Tap Set up Owner to add a partner, their first job, costs, and paycheck dates."
        />
      </Card>
    </>
  );
}

import { useAsync } from '../../hooks/useAsync.js';
import { getMyEarnedCommissions } from '../../lib/data/commissions.js';
import { PageHeader } from '../../components/ui/PageHeader.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { StatCard } from '../../components/ui/StatCard.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { Money } from '../../components/ui/Money.jsx';
import { Loading } from '../../components/ui/Loading.jsx';
import { ErrorState } from '../../components/ui/ErrorState.jsx';
import { Disclaimer } from '../../components/ui/Disclaimer.jsx';
import { COMMISSION_BASIS_LABELS } from '../../lib/constants.js';
import { formatCurrency, formatPercent } from '../../lib/formatting/money.js';

export default function OwnerCommissionsPage() {
  const { data, loading, error, refresh } = useAsync(() => getMyEarnedCommissions(), []);

  if (loading) return <Loading full label="Loading your commissions…" />;
  if (error) return <ErrorState error={error} onRetry={refresh} />;

  const rows = (data || []).filter((r) => r.active);
  const totalAnnual = rows.reduce((s, r) => s + (Number(r.annual_commission_cents) || 0), 0);

  return (
    <>
      <PageHeader
        title="Referral Commissions"
        subtitle="Commissions you earn from Owners you referred — typically 10% of their net profit after tax and costs."
      />

      <div className="stat-grid">
        <StatCard label="Annual Commission" value={formatCurrency(totalAnnual)} emphasis />
        <StatCard label="Monthly Equivalent" value={formatCurrency(Math.round(totalAnnual / 12))} />
        <StatCard label="Biweekly Equivalent" value={formatCurrency(Math.round(totalAnnual / 26))} />
      </div>

      <Card padded={false}>
        <DataTable
          columns={[
            { key: 'who', header: 'Referred Owner', mobile: 'title', render: (r) => <strong>{r.referred_display_name}</strong> },
            { key: 'basis', header: 'Basis', mobile: 'meta', render: (r) => COMMISSION_BASIS_LABELS[r.commission_basis_type] },
            {
              key: 'rate',
              header: 'Rate',
              mobile: 'meta',
              render: (r) => formatPercent(r.commission_rate),
              renderMobile: (r) => `${formatPercent(r.commission_rate)} rate`,
            },
            { key: 'annual', header: 'Annual', mobile: 'amount', render: (r) => <Money cents={r.annual_commission_cents} /> },
            { key: 'monthly', header: 'Monthly', hideOnMobile: true, render: (r) => <Money cents={Math.round(r.annual_commission_cents / 12)} /> },
            { key: 'biweekly', header: 'Biweekly', hideOnMobile: true, render: (r) => <Money cents={Math.round(r.annual_commission_cents / 26)} /> },
          ]}
          rows={rows}
          getRowKey={(r) => r.referral_id}
          emptyTitle="No commissions"
          emptyMessage="You don't currently earn referral commissions."
        />
      </Card>
      <Disclaimer />
    </>
  );
}

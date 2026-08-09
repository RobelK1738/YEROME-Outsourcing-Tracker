import { useMemo, useState } from 'react';
import { useAsync } from '../../hooks/useAsync.js';
import { listReferrals, archiveReferral } from '../../lib/data/commissions.js';
import { listOwners } from '../../lib/data/owners.js';
import { listJobs } from '../../lib/data/jobs.js';
import { PageHeader } from '../../components/ui/PageHeader.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { Loading } from '../../components/ui/Loading.jsx';
import { ErrorState } from '../../components/ui/ErrorState.jsx';
import { ReferralFormModal } from '../../components/forms/ReferralFormModal.jsx';
import { COMMISSION_BASIS_LABELS } from '../../lib/constants.js';
import { formatPercent, formatCurrency } from '../../lib/formatting/money.js';

export default function CommissionsPage() {
  const [activeOnly, setActiveOnly] = useState(false);
  const [modal, setModal] = useState({ open: false, initial: null });

  const { data: owners } = useAsync(() => listOwners(), []);
  const { data: jobs } = useAsync(() => listJobs(), []);
  const { data: referrals, loading, error, refresh } = useAsync(() => listReferrals(), []);

  const filtered = useMemo(
    () => (referrals || []).filter((r) => (activeOnly ? r.active : true)),
    [referrals, activeOnly],
  );

  const columns = [
    { key: 'referrer', header: 'Referrer', mobile: 'title', render: (r) => <strong>{r.referrer?.display_name || '—'}</strong> },
    {
      key: 'referred',
      header: 'Referred',
      mobile: 'meta',
      render: (r) => r.referred?.display_name || '—',
      renderMobile: (r) => `→ ${r.referred?.display_name || '—'}`,
    },
    { key: 'rate', header: 'Rate', mobile: 'amount', render: (r) => formatPercent(r.commission_rate) },
    { key: 'basis', header: 'Basis', hideOnMobile: true, render: (r) => COMMISSION_BASIS_LABELS[r.commission_basis_type] },
    {
      key: 'flat',
      header: 'Flat',
      hideOnMobile: true,
      render: (r) => (r.flat_amount_cents != null ? formatCurrency(r.flat_amount_cents) : '—'),
    },
    { key: 'status', header: 'Status', mobile: 'badge', render: (r) => <Badge tone={r.active ? 'ok' : 'muted'}>{r.active ? 'Active' : 'Inactive'}</Badge> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      mobile: 'actions',
      render: (r) => (
        <div className="row row--end">
          <button className="btn btn--secondary btn--sm" onClick={() => setModal({ open: true, initial: r })}>
            Edit
          </button>
          {r.active ? (
            <button
              className="btn btn--ghost btn--sm"
              onClick={async () => {
                if (confirm('Deactivate this referral?')) {
                  await archiveReferral(r.id);
                  refresh();
                }
              }}
            >
              Deactivate
            </button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Commissions"
        subtitle="Middle-man relationships. Default: 10% of the referred Owner's net profit after tax and owner-quoted costs."
        actions={
          <button className="btn btn--primary" onClick={() => setModal({ open: true, initial: null })}>
            + New Referral
          </button>
        }
      />

      <div className="toolbar">
        <label className="row text-sm">
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} /> Active only
        </label>
      </div>

      <Card padded={false}>
        {loading ? (
          <Loading label="Loading referrals…" />
        ) : error ? (
          <ErrorState error={error} onRetry={refresh} />
        ) : (
          <DataTable
            columns={columns}
            rows={filtered}
            emptyTitle="No referrals yet"
            emptyMessage="Create a referral so one Owner earns commission from another."
          />
        )}
      </Card>

      <ReferralFormModal
        open={modal.open}
        initial={modal.initial}
        owners={owners || []}
        jobs={jobs || []}
        onClose={() => setModal({ open: false, initial: null })}
        onSaved={refresh}
      />
    </>
  );
}

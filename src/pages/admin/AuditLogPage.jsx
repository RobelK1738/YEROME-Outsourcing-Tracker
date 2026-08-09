import { useAsync } from '../../hooks/useAsync.js';
import { listAuditLog } from '../../lib/data/audit.js';
import { PageHeader } from '../../components/ui/PageHeader.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { Loading } from '../../components/ui/Loading.jsx';
import { ErrorState } from '../../components/ui/ErrorState.jsx';

function formatWhen(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function AuditLogPage() {
  const { data, loading, error, refresh } = useAsync(() => listAuditLog(), []);

  const columns = [
    { key: 'when', header: 'When', mobile: 'meta', render: (r) => <span className="mono text-sm">{formatWhen(r.created_at)}</span> },
    { key: 'action', header: 'Action', mobile: 'title', render: (r) => <Badge tone="info">{r.action}</Badge> },
    { key: 'entity', header: 'Entity', mobile: 'meta', render: (r) => r.entity_type || '—' },
    {
      key: 'details',
      header: 'Details',
      render: (r) => (
        <span className="mono text-xs muted">
          {r.metadata_json ? JSON.stringify(r.metadata_json) : '—'}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Audit Log" subtitle="Chronological record of important YEROME changes." />
      <Card padded={false}>
        {loading ? (
          <Loading label="Loading audit log…" />
        ) : error ? (
          <ErrorState error={error} onRetry={refresh} />
        ) : (
          <DataTable
            columns={columns}
            rows={data}
            emptyTitle="No audit entries yet"
            emptyMessage="Actions like creating Owners and editing jobs will appear here."
          />
        )}
      </Card>
    </>
  );
}

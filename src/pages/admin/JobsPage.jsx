import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAsync } from '../../hooks/useAsync.js';
import { listJobs, deleteJob } from '../../lib/data/jobs.js';
import { listOwners } from '../../lib/data/owners.js';
import { PageHeader } from '../../components/ui/PageHeader.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { StatusBadge } from '../../components/ui/Badge.jsx';
import { Money } from '../../components/ui/Money.jsx';
import { Loading } from '../../components/ui/Loading.jsx';
import { ErrorState } from '../../components/ui/ErrorState.jsx';
import { JobFormModal } from '../../components/forms/JobFormModal.jsx';
import { JOB_STATUSES, JOB_STATUS_LABELS } from '../../lib/constants.js';

export default function JobsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [modal, setModal] = useState({ open: false, initial: null });

  const { data: owners } = useAsync(() => listOwners(), []);
  const { data: jobs, loading, error, refresh } = useAsync(() => listJobs(), []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (jobs || []).filter((j) => {
      if (status !== 'all' && j.status !== status) return false;
      if (ownerFilter !== 'all' && j.owner_id !== ownerFilter) return false;
      if (!q) return true;
      return (
        j.employer_name?.toLowerCase().includes(q) ||
        j.role_title?.toLowerCase().includes(q) ||
        j.owner?.display_name?.toLowerCase().includes(q)
      );
    });
  }, [jobs, search, status, ownerFilter]);

  const columns = [
    { key: 'employer', header: 'Employer', mobile: 'title', render: (j) => <strong>{j.employer_name}</strong> },
    { key: 'owner', header: 'Owner', mobile: 'meta', render: (j) => j.owner?.display_name || '—' },
    { key: 'role', header: 'Role', hideOnMobile: true, render: (j) => j.role_title || '—' },
    { key: 'salary', header: 'Annual', mobile: 'amount', render: (j) => <Money cents={j.annual_salary_cents} /> },
    { key: 'status', header: 'Status', mobile: 'badge', render: (j) => <StatusBadge status={j.status} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      // Phones open the job to edit or delete it, so the row stays tap-sized.
      hideOnMobile: true,
      render: (j) => (
        <div className="row row--end" onClick={(e) => e.stopPropagation()}>
          <button className="btn btn--secondary btn--sm" onClick={() => setModal({ open: true, initial: j })}>
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
  ];

  return (
    <>
      <PageHeader
        title="Jobs"
        subtitle="All jobs across every Owner"
        actions={
          <button className="btn btn--primary" onClick={() => setModal({ open: true, initial: null })}>
            + New Job
          </button>
        }
      />

      <div className="toolbar">
        <input
          className="input toolbar__grow"
          placeholder="Search employer, role, or owner…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="input" value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
          <option value="all">All owners</option>
          {(owners || []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.display_name}
            </option>
          ))}
        </select>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All statuses</option>
          {JOB_STATUSES.map((s) => (
            <option key={s} value={s}>
              {JOB_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      <Card padded={false}>
        {loading ? (
          <Loading label="Loading jobs…" />
        ) : error ? (
          <ErrorState error={error} onRetry={refresh} />
        ) : (
          <DataTable
            columns={columns}
            rows={filtered}
            onRowClick={(j) => navigate(`/admin/jobs/${j.id}`)}
            emptyTitle="No jobs found"
            emptyMessage="Add a job to begin tracking financials."
          />
        )}
      </Card>

      <JobFormModal
        open={modal.open}
        initial={modal.initial}
        owners={owners || []}
        onClose={() => setModal({ open: false, initial: null })}
        onSaved={refresh}
      />
    </>
  );
}

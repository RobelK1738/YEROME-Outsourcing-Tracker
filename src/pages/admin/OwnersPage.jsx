import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAsync } from '../../hooks/useAsync.js';
import { listOwners } from '../../lib/data/owners.js';
import { createOwner } from '../../lib/data/adminApi.js';
import { PageHeader } from '../../components/ui/PageHeader.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { StatusBadge } from '../../components/ui/Badge.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Field, TextInput, Select, TextArea } from '../../components/ui/Field.jsx';
import { Loading } from '../../components/ui/Loading.jsx';
import { ErrorState } from '../../components/ui/ErrorState.jsx';
import {
  FILING_STATUSES,
  FILING_STATUS_LABELS,
  OWNER_STATUSES,
  OWNER_STATUS_LABELS,
  DEAL_TYPES,
  DEAL_TYPE_LABELS,
  DEAL_TYPE_HINTS,
} from '../../lib/constants.js';
const EMPTY_FORM = {
  displayName: '',
  username: '',
  password: '',
  filingStatus: 'single',
  dealType: 'three_way',
  state: 'TX',
  safetyReservePct: '12',
  notes: '',
};

export default function OwnersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const { data: owners, loading, error, refresh } = useAsync(() => listOwners(), []);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (owners || []).filter((o) => {
      if (status !== 'all' && o.status !== status) return false;
      if (!q) return true;
      return o.display_name?.toLowerCase().includes(q) || o.username?.toLowerCase().includes(q);
    });
  }, [owners, search, status]);

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e) => {
    e.preventDefault();
    setFormError('');
    const pct = Number(form.safetyReservePct);
    if (!(pct >= 0 && pct <= 100)) {
      setFormError('Safety reserve must be between 0 and 100%.');
      return;
    }
    setSaving(true);
    try {
      await createOwner({
        displayName: form.displayName.trim(),
        username: form.username.trim().toLowerCase(),
        password: form.password,
        filingStatus: form.filingStatus,
        dealType: form.dealType,
        state: form.state.trim() || 'TX',
        safetyReserveRate: pct / 100,
        notes: form.notes.trim() || null,
      });
      setShowCreate(false);
      setForm(EMPTY_FORM);
      refresh();
    } catch (err) {
      setFormError(err.message || 'Could not create Owner.');
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    { key: 'name', header: 'Owner', mobile: 'title', render: (o) => <strong>{o.display_name}</strong> },
    { key: 'username', header: 'Username', mono: true, mobile: 'meta', render: (o) => o.username },
    {
      key: 'deal',
      header: 'Deal',
      mobile: 'meta',
      render: (o) => DEAL_TYPE_LABELS[o.deal_type] || DEAL_TYPE_LABELS.three_way,
    },
    {
      key: 'filing',
      header: 'Filing',
      hideOnMobile: true,
      render: (o) => FILING_STATUS_LABELS[o.filing_status],
    },
    { key: 'state', header: 'State', hideOnMobile: true, render: (o) => o.state },
    { key: 'status', header: 'Status', mobile: 'badge', render: (o) => <StatusBadge status={o.status} kind="owner" /> },
  ];

  return (
    <>
      <PageHeader
        title="Owners"
        subtitle="US Partners"
        actions={
          <div className="row">
            <button className="btn btn--primary" onClick={() => navigate('/admin/setup')}>
              Set up Owner
            </button>
          </div>
        }
      />

      <div className="toolbar">
        <input
          className="input toolbar__grow"
          placeholder="Search by name or username…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All statuses</option>
          {OWNER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {OWNER_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      <Card padded={false}>
        {loading ? (
          <Loading label="Loading owners…" />
        ) : error ? (
          <ErrorState error={error} onRetry={refresh} />
        ) : (
          <DataTable
            columns={columns}
            rows={filtered}
            onRowClick={(o) => navigate(`/admin/owners/${o.id}`)}
            emptyTitle="No owners found"
            emptyMessage="Set up an Owner with their first job, cost package, and paycheck dates."
            emptyAction={
              <button className="btn btn--primary" onClick={() => navigate('/admin/setup')}>
                Set up Owner
              </button>
            }
          />
        )}
      </Card>

      <Modal
        open={showCreate}
        title="Create Owner"
        onClose={() => setShowCreate(false)}
        footer={
          <>
            <button className="btn btn--secondary" onClick={() => setShowCreate(false)} disabled={saving}>
              Cancel
            </button>
            <button className="btn btn--primary" onClick={submit} disabled={saving} form="owner-form">
              {saving ? 'Creating…' : 'Create Owner'}
            </button>
          </>
        }
      >
        {formError ? <div className="form-error">{formError}</div> : null}
        <form id="owner-form" onSubmit={submit}>
          <div className="form-grid">
            <div className="form-grid--full">
              <Field label="Display name" htmlFor="o-name" required>
                <TextInput
                  id="o-name"
                  value={form.displayName}
                  onChange={(e) => setField('displayName', e.target.value)}
                  required
                />
              </Field>
            </div>
            <Field label="Username" htmlFor="o-user" hint="Lowercase letters, numbers, underscores." required>
              <TextInput
                id="o-user"
                value={form.username}
                onChange={(e) => setField('username', e.target.value)}
                required
              />
            </Field>
            <Field label="Initial password" htmlFor="o-pass" hint="At least 8 characters." required>
              <TextInput
                id="o-pass"
                type="text"
                value={form.password}
                onChange={(e) => setField('password', e.target.value)}
                required
              />
            </Field>
            <Field label="Filing status" htmlFor="o-filing" required>
              <Select
                id="o-filing"
                value={form.filingStatus}
                onChange={(e) => setField('filingStatus', e.target.value)}
                options={FILING_STATUSES.map((s) => ({ value: s, label: FILING_STATUS_LABELS[s] }))}
              />
            </Field>
            <Field
              label="Deal structure"
              htmlFor="o-deal"
              hint={DEAL_TYPE_HINTS[form.dealType] || DEAL_TYPE_HINTS.three_way}
              required
            >
              <Select
                id="o-deal"
                value={form.dealType}
                onChange={(e) => setField('dealType', e.target.value)}
                options={DEAL_TYPES.map((s) => ({ value: s, label: DEAL_TYPE_LABELS[s] }))}
              />
            </Field>
            <Field label="State" htmlFor="o-state">
              <TextInput id="o-state" value={form.state} onChange={(e) => setField('state', e.target.value)} />
            </Field>
            <Field label="Safety reserve %" htmlFor="o-reserve" hint="Default 12%.">
              <TextInput
                id="o-reserve"
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={form.safetyReservePct}
                onChange={(e) => setField('safetyReservePct', e.target.value)}
              />
            </Field>
            <div className="form-grid--full">
              <Field label="Notes" htmlFor="o-notes">
                <TextArea id="o-notes" value={form.notes} onChange={(e) => setField('notes', e.target.value)} />
              </Field>
            </div>
          </div>
        </form>
      </Modal>
    </>
  );
}

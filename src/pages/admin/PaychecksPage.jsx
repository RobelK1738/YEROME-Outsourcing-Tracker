import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAsync } from '../../hooks/useAsync.js';
import { getPaycheckPlanner } from '../../lib/data/financials.js';
import { listUpcomingPaychecks } from '../../lib/data/paychecks.js';
import { PageHeader } from '../../components/ui/PageHeader.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { Money } from '../../components/ui/Money.jsx';
import { Loading } from '../../components/ui/Loading.jsx';
import { ErrorState } from '../../components/ui/ErrorState.jsx';
import { Disclaimer } from '../../components/ui/Disclaimer.jsx';
import { GroupedTable } from '../../components/ui/GroupedTable.jsx';
import { computeDatedPaycheckPlan } from '../../lib/calculations/summary.js';
import { formatCurrency } from '../../lib/formatting/money.js';
import { formatDate, todayISO } from '../../lib/formatting/dates.js';
import { JOB_PAYCHECK_STATUS_LABELS } from '../../lib/constants.js';

const STATUS_TONE = { scheduled: 'info', paid: 'ok', skipped: 'muted' };

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** Per-paycheck gross / owner keep / YEROME roll-up shown on a collapsed group. */
function paycheckTotals(rows) {
  let gross = 0;
  let ownerKeep = 0;
  let ops = 0;
  for (const { recommendation } of rows) {
    gross += recommendation.expectedGrossCents || 0;
    ownerKeep += recommendation.ownerCutCents ?? recommendation.recommendedRemainingCents ?? 0;
    ops += recommendation.opsCutCents || 0;
  }
  return [
    { label: 'Gross', value: <Money cents={gross} />, hideOnMobile: true },
    { label: 'Owner', value: <Money cents={ownerKeep} tone="positive" /> },
    { label: 'YEROME', value: <Money cents={ops} />, hideOnMobile: true },
  ];
}

/** Owner → jobs, so a per-job list across every Owner stays scannable. */
function groupTypicalRowsByOwner(rows) {
  const byOwner = new Map();
  for (const row of rows) {
    if (!byOwner.has(row.owner.id)) {
      byOwner.set(row.owner.id, { key: row.owner.id, label: row.owner.display_name, rows: [] });
    }
    byOwner.get(row.owner.id).rows.push(row);
  }
  return [...byOwner.values()]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((group) => ({
      ...group,
      rows: [...group.rows].sort((a, b) => a.job.employer_name.localeCompare(b.job.employer_name)),
    }));
}

/** One job's typical paycheck, itemized. */
function TypicalPaycheckDetail({ row, onOpenJob }) {
  const rec = row.recommendation;
  const lines = [
    ['Gross', rec.expectedGrossCents],
    ['Estimated taxes', rec.estimatedTaxCents],
    ['Owner-quoted costs', rec.quotedCostsCents],
    ['Owner-quoted net', rec.netProfitCents],
    ['Owner keep', rec.ownerCutCents ?? rec.recommendedRemainingCents],
    ['Safety reserve (from Owner keep)', rec.safetyReserveCents],
    ['YEROME take-home', rec.opsCutCents],
  ];
  return (
    <div className="breakdown">
      {lines.map(([label, cents], i) => (
        <div className={`breakdown__row ${i === lines.length - 1 ? 'breakdown__row--total' : ''}`} key={label}>
          <span className="breakdown__label">{label}</span>
          <span className="breakdown__value">{formatCurrency(cents || 0)}</span>
        </div>
      ))}
      <div className="row mt-8">
        <button type="button" className="btn btn--secondary btn--sm" onClick={onOpenJob}>
          Open job
        </button>
      </div>
    </div>
  );
}

export default function PaychecksPage() {
  const navigate = useNavigate();
  const loader = async () => {
    const [planner, upcoming] = await Promise.all([
      getPaycheckPlanner(),
      listUpcomingPaychecks({ from: todayISO() }),
    ]);
    return { planner, upcoming };
  };
  const { data, loading, error, refresh } = useAsync(loader, []);
  const [ownerFilter, setOwnerFilter] = useState('all');

  const owners = useMemo(() => {
    if (!data) return [];
    const seen = new Map();
    for (const r of data.planner.rows) seen.set(r.owner.id, r.owner.display_name);
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [data]);

  // Merge scheduled dated paychecks with each job's computed breakdown.
  const datedRows = useMemo(() => {
    if (!data) return [];
    const { breakdownByJobId, ownerById } = data.planner;
    return data.upcoming
      .filter((pc) => (ownerFilter === 'all' ? true : pc.job?.owner_id === ownerFilter))
      .map((pc) => {
        const breakdown = breakdownByJobId[pc.job_id];
        const plan = breakdown ? computeDatedPaycheckPlan(breakdown, pc.expected_gross_cents) : null;
        const owner = ownerById.get(pc.job?.owner_id);
        return { pc, plan, owner };
      });
  }, [data, ownerFilter]);

  if (loading) return <Loading full label="Building the paycheck plan…" />;
  if (error) return <ErrorState error={error} onRetry={refresh} />;

  const showTypicalFallback = datedRows.length === 0;
  const typicalRows = showTypicalFallback
    ? ownerFilter === 'all'
      ? data.planner.rows
      : data.planner.rows.filter((r) => r.owner.id === ownerFilter)
    : [];
  const typicalGroups = groupTypicalRowsByOwner(typicalRows);

  return (
    <>
      <PageHeader
        title="Paychecks"
        subtitle="Upcoming dated paychecks"
      />

      <div className="toolbar">
        <select className="input" value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
          <option value="all">All owners</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>

      <Card title="Upcoming paychecks" padded={false}>
        <DataTable
          columns={[
            { key: 'date', header: 'Pay date', hideOnMobile: true, render: (r) => <strong>{formatDate(r.pc.pay_date)}</strong> },
            { key: 'owner', header: 'Owner', mobile: 'meta', render: (r) => r.owner?.display_name || '—' },
            { key: 'job', header: 'Job', mobile: 'title', render: (r) => r.pc.job?.employer_name || '—' },
            { key: 'gross', header: 'Gross', hideOnMobile: true, render: (r) => (r.plan ? <Money cents={r.plan.expectedGrossCents} /> : '—') },
            { key: 'owner_keep', header: 'Owner keep', mobile: 'amount', render: (r) => (r.plan ? <Money cents={r.plan.ownerCutCents ?? r.plan.recommendedRemainingCents} tone="positive" /> : '—') },
            { key: 'ops', header: 'YEROME take-home', hideOnMobile: true, render: (r) => (r.plan ? <Money cents={r.plan.opsCutCents || 0} /> : '—') },
            { key: 'status', header: 'Status', mobile: 'badge', render: (r) => <Badge tone={STATUS_TONE[r.pc.status] || 'muted'}>{JOB_PAYCHECK_STATUS_LABELS[r.pc.status]}</Badge> },
          ]}
          rows={datedRows}
          getRowKey={(r) => r.pc.id}
          mobilePageSize={12}
          mobileGroup={(r) => ({ key: r.pc.pay_date, label: formatDate(r.pc.pay_date) })}
          onRowClick={(r) => navigate(`/admin/jobs/${r.pc.job_id}`)}
          emptyTitle="No upcoming paychecks scheduled"
          emptyMessage="Open a job and generate a paycheck schedule."
        />
      </Card>

      {showTypicalFallback ? (
        <Card
          title="Typical paycheck by job"
          subtitle="Shown until dated schedules exist. Expand an Owner, then a job."
          padded={false}
        >
          <GroupedTable
            groups={typicalGroups.map((ownerGroup) => ({
              key: ownerGroup.key,
              label: ownerGroup.label,
              meta: plural(ownerGroup.rows.length, 'job'),
              totals: paycheckTotals(ownerGroup.rows),
              defaultOpen: typicalGroups.length === 1,
              groups: ownerGroup.rows.map((row) => ({
                key: row.job.id,
                label: row.job.employer_name,
                meta: row.job.role_title || 'Support role',
                totals: paycheckTotals([row]),
                children: (
                  <TypicalPaycheckDetail row={row} onOpenJob={() => navigate(`/admin/jobs/${row.job.id}`)} />
                ),
              })),
            }))}
            emptyTitle="No active jobs"
          />
        </Card>
      ) : null}

      <Disclaimer />
    </>
  );
}

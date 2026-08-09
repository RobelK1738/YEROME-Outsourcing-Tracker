import { useMemo, useState } from 'react';
import { useAsync } from '../../hooks/useAsync.js';
import { listCosts, deleteCost } from '../../lib/data/costs.js';
import { listOwners } from '../../lib/data/owners.js';
import { listJobs } from '../../lib/data/jobs.js';
import { PageHeader } from '../../components/ui/PageHeader.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { Money } from '../../components/ui/Money.jsx';
import { Loading } from '../../components/ui/Loading.jsx';
import { ErrorState } from '../../components/ui/ErrorState.jsx';
import { CostFormModal } from '../../components/forms/CostFormModal.jsx';
import { AssignCostTemplatesModal } from '../../components/forms/AssignCostTemplatesModal.jsx';
import { CostTemplateFormModal } from '../../components/forms/CostTemplateFormModal.jsx';
import { listCostTemplates, deleteCostTemplate } from '../../lib/data/costTemplates.js';
import { GroupedTable } from '../../components/ui/GroupedTable.jsx';
import { COST_TYPES, COST_TYPE_LABELS, COST_CADENCE_LABELS } from '../../lib/constants.js';
import { costToAnnual, marginBreakdown } from '../../lib/calculations/costs.js';
import { quotedCentsForDeal, templateMarginCents } from '../../lib/costTemplates.js';
import { annualToMonthly, formatPercent } from '../../lib/formatting/money.js';

const GLOBAL_KEY = '__all_owners__';
const OWNER_LEVEL_KEY = '__owner_level__';

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Monthly quoted / actual / margin roll-up for a group's summary row. Costs are
 * annualized first so mixed cadences (per paycheck, monthly, annual) can be
 * added together, then converted once to keep the rounding honest.
 */
function monthlyTotals(costs) {
  let quotedAnnual = 0;
  let actualAnnual = 0;
  for (const cost of costs) {
    quotedAnnual += costToAnnual(cost.quoted_amount_cents, cost.cadence);
    actualAnnual += costToAnnual(cost.internal?.actual_amount_cents ?? cost.quoted_amount_cents, cost.cadence);
  }
  const quoted = annualToMonthly(quotedAnnual);
  const actual = annualToMonthly(actualAnnual);
  const margin = quoted - actual;
  return [
    { label: 'Quoted /mo', value: <Money cents={quoted} />, hideOnMobile: true },
    { label: 'Actual /mo', value: <Money cents={actual} />, hideOnMobile: true },
    { label: 'Margin /mo', value: <Money cents={margin} tone={margin >= 0 ? 'positive' : 'negative'} /> },
  ];
}

/** Owner → job → itemized costs, so a flat 70-row dump stays scannable. */
function groupCostsByOwnerThenJob(costs, owners) {
  const ownerNameById = new Map(owners.map((o) => [o.id, o.display_name]));
  const byOwner = new Map();

  for (const cost of costs) {
    const ownerId = cost.job?.owner_id || cost.owner_id || null;
    const ownerKey = ownerId || GLOBAL_KEY;
    if (!byOwner.has(ownerKey)) {
      byOwner.set(ownerKey, {
        key: ownerKey,
        label: ownerId
          ? ownerNameById.get(ownerId) || cost.owner?.display_name || 'Unknown Owner'
          : 'Shared across all Owners',
        jobs: new Map(),
      });
    }
    const ownerGroup = byOwner.get(ownerKey);
    const jobKey = cost.job_id || OWNER_LEVEL_KEY;
    if (!ownerGroup.jobs.has(jobKey)) {
      ownerGroup.jobs.set(jobKey, {
        key: jobKey,
        label: cost.job
          ? cost.job.employer_name
          : ownerId
            ? 'Owner-level'
            : 'All active jobs',
        costs: [],
      });
    }
    ownerGroup.jobs.get(jobKey).costs.push(cost);
  }

  return [...byOwner.values()]
    .sort((a, b) => {
      if (a.key === GLOBAL_KEY) return 1;
      if (b.key === GLOBAL_KEY) return -1;
      return a.label.localeCompare(b.label);
    })
    .map((ownerGroup) => {
      const jobs = [...ownerGroup.jobs.values()].sort((a, b) => {
        if (a.key === OWNER_LEVEL_KEY) return -1;
        if (b.key === OWNER_LEVEL_KEY) return 1;
        return a.label.localeCompare(b.label);
      });
      return {
        key: ownerGroup.key,
        label: ownerGroup.label,
        jobs,
        jobCount: jobs.filter((jobGroup) => jobGroup.key !== OWNER_LEVEL_KEY).length,
        costs: jobs.flatMap((jobGroup) => jobGroup.costs),
      };
    });
}

export default function CostsPage() {
  const [type, setType] = useState('all');
  const [activeOnly, setActiveOnly] = useState(true);
  const [modal, setModal] = useState({ open: false, initial: null });
  const [assignOpen, setAssignOpen] = useState(false);
  const [templateModal, setTemplateModal] = useState({ open: false, initial: null });

  const { data: owners } = useAsync(() => listOwners(), []);
  const { data: jobs } = useAsync(() => listJobs(), []);
  const { data: costs, loading, error, refresh } = useAsync(() => listCosts(), []);
  const {
    data: templates,
    loading: templatesLoading,
    error: templatesError,
    refresh: refreshTemplates,
  } = useAsync(() => listCostTemplates({ active: 'all' }), []);

  const filtered = useMemo(() => {
    return (costs || []).filter((c) => {
      if (type !== 'all' && c.cost_type !== type) return false;
      if (activeOnly && !c.active) return false;
      return true;
    });
  }, [costs, type, activeOnly]);

  const ownerGroups = useMemo(() => groupCostsByOwnerThenJob(filtered, owners || []), [filtered, owners]);

  const templateColumns = [
    {
      key: 'name',
      header: 'Template',
      mobile: 'title',
      render: (t) => (
        <span>
          <strong>{t.name}</strong>
          {t.is_default ? <span className="muted text-xs"> · standard</span> : null}
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      mobile: 'badge',
      render: (t) => (
        <Badge tone={t.cost_type === 'fixed' ? 'info' : 'brand'}>{COST_TYPE_LABELS[t.cost_type]}</Badge>
      ),
    },
    {
      key: 'cadence',
      header: 'Cadence',
      mobile: 'meta',
      render: (t) => COST_CADENCE_LABELS[t.cadence],
    },
    {
      key: 'quoted',
      header: 'Quoted',
      mobile: 'amount',
      render: (t) => (
        <span>
          <Money cents={quotedCentsForDeal(t, 'three_way')} />
          {quotedCentsForDeal(t, 'no_middle') !== quotedCentsForDeal(t, 'three_way') ? (
            <span className="muted text-xs"> · no-middle <Money cents={quotedCentsForDeal(t, 'no_middle')} /></span>
          ) : null}
        </span>
      ),
    },
    { key: 'actual', header: 'Actual', render: (t) => <Money cents={t.actual_amount_cents} /> },
    {
      key: 'margin',
      header: 'Margin',
      render: (t) => {
        const margin = templateMarginCents(t);
        return <Money cents={margin} tone={margin >= 0 ? 'positive' : 'negative'} />;
      },
    },
    {
      key: 'status',
      header: 'Status',
      hideOnMobile: true,
      render: (t) => (t.active ? <Badge tone="ok">Active</Badge> : <Badge tone="muted">Inactive</Badge>),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      mobile: 'actions',
      render: (t) => (
        <div className="row row--end">
          <button
            className="btn btn--secondary btn--sm"
            onClick={() => setTemplateModal({ open: true, initial: t })}
          >
            Edit
          </button>
          <button
            className="btn btn--danger btn--sm"
            onClick={async () => {
              if (
                confirm(
                  `Delete template "${t.name}"? Costs already assigned from it are kept — only the template is removed.`,
                )
              ) {
                await deleteCostTemplate(t.id);
                refreshTemplates();
              }
            }}
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  const columns = [
    { key: 'name', header: 'Cost', mobile: 'title', render: (c) => <strong>{c.name}</strong> },
    { key: 'type', header: 'Type', mobile: 'badge', render: (c) => <Badge tone={c.cost_type === 'fixed' ? 'info' : 'brand'}>{COST_TYPE_LABELS[c.cost_type]}</Badge> },
    { key: 'cadence', header: 'Cadence', mobile: 'meta', render: (c) => COST_CADENCE_LABELS[c.cadence] },
    { key: 'quoted', header: 'Quoted', mobile: 'amount', render: (c) => <Money cents={c.quoted_amount_cents} /> },
    {
      key: 'actual',
      header: 'Actual',
      render: (c) => (c.internal ? <Money cents={c.internal.actual_amount_cents} /> : <span className="muted">—</span>),
    },
    {
      key: 'margin',
      header: 'Margin',
      render: (c) => {
        if (!c.internal) return <span className="muted">—</span>;
        const m = marginBreakdown({
          quotedAmountCents: c.quoted_amount_cents,
          actualAmountCents: c.internal.actual_amount_cents,
          cadence: c.cadence,
        });
        return (
          <span>
            <Money cents={c.quoted_amount_cents - c.internal.actual_amount_cents} tone={c.quoted_amount_cents - c.internal.actual_amount_cents >= 0 ? 'positive' : 'negative'} />{' '}
            <span className="muted text-xs">({formatPercent(m.marginPercent)})</span>
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      mobile: 'actions',
      render: (c) => (
        <div className="row row--end">
          <button className="btn btn--secondary btn--sm" onClick={() => setModal({ open: true, initial: c })}>
            Edit
          </button>
          <button
            className="btn btn--danger btn--sm"
            onClick={async () => {
              if (confirm(`Permanently delete cost "${c.name}"? This cannot be undone.`)) {
                await deleteCost(c.id);
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
        title="Costs"
        subtitle="Build your own cost templates so quoted + actual amounts are filled once — then assign them to Owners and jobs."
        actions={
          <div className="row">
            <button className="btn btn--secondary" onClick={() => setAssignOpen(true)}>
              Assign templates
            </button>
            <button className="btn btn--primary" onClick={() => setModal({ open: true, initial: null })}>
              + New Cost
            </button>
          </div>
        }
      />

      <div className="toolbar">
        <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">All types</option>
          {COST_TYPES.map((t) => (
            <option key={t} value={t}>
              {COST_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <label className="row text-sm">
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} /> Active only
        </label>
      </div>

      <Card
        title="Cost templates"
        subtitle="Reusable packages with quoted + actual amounts, so you fill a charge in once and assign it. Editing a template leaves already-assigned costs alone."
        padded={false}
        actions={
          <button
            className="btn btn--secondary btn--sm"
            onClick={() => setTemplateModal({ open: true, initial: null })}
          >
            + New template
          </button>
        }
      >
        {templatesLoading ? (
          <Loading label="Loading templates…" />
        ) : templatesError ? (
          <ErrorState error={templatesError} onRetry={refreshTemplates} />
        ) : (
          <DataTable
            columns={templateColumns}
            rows={templates || []}
            emptyTitle="No cost templates yet"
            emptyMessage="Create one for each standard charge you bill, e.g. Rent + WIFI + VPN or Worker Wage."
            emptyAction={
              <button
                className="btn btn--primary btn--sm"
                onClick={() => setTemplateModal({ open: true, initial: null })}
              >
                + New template
              </button>
            }
          />
        )}
      </Card>

      <Card
        title="Costs by Owner"
        subtitle="Expand an Owner, then a job, to see its itemized costs. Group totals are monthly."
        padded={false}
      >
        {loading ? (
          <Loading label="Loading costs…" />
        ) : error ? (
          <ErrorState error={error} onRetry={refresh} />
        ) : (
          <GroupedTable
            groups={ownerGroups.map((ownerGroup) => ({
              key: ownerGroup.key,
              label: ownerGroup.label,
              meta: `${plural(ownerGroup.jobCount, 'job')} · ${plural(ownerGroup.costs.length, 'cost')}`,
              totals: monthlyTotals(ownerGroup.costs),
              defaultOpen: ownerGroups.length === 1,
              groups: ownerGroup.jobs.map((jobGroup) => ({
                key: jobGroup.key,
                label: jobGroup.label,
                meta: plural(jobGroup.costs.length, 'cost'),
                totals: monthlyTotals(jobGroup.costs),
                children: <DataTable columns={columns} rows={jobGroup.costs} emptyTitle="No costs" />,
              })),
            }))}
            emptyTitle="No costs found"
            emptyMessage="Add a per-job worker cost or a shared fixed cost."
          />
        )}
      </Card>

      <CostFormModal
        open={modal.open}
        initial={modal.initial}
        owners={owners || []}
        jobs={jobs || []}
        onClose={() => setModal({ open: false, initial: null })}
        onSaved={refresh}
      />
      <AssignCostTemplatesModal
        open={assignOpen}
        owners={owners || []}
        jobs={jobs || []}
        mode="all"
        onClose={() => setAssignOpen(false)}
        onSaved={refresh}
      />
      <CostTemplateFormModal
        open={templateModal.open}
        initial={templateModal.initial}
        onClose={() => setTemplateModal({ open: false, initial: null })}
        onSaved={refreshTemplates}
      />
    </>
  );
}

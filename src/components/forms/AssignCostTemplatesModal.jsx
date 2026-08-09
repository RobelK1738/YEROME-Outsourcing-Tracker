import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../ui/Modal.jsx';
import { Field, Select } from '../ui/Field.jsx';
import { applyCostTemplates } from '../../lib/data/costs.js';
import { listCostTemplates } from '../../lib/data/costTemplates.js';
import {
  costTemplateLabel,
  defaultTemplateIds,
  quotedCentsForDeal,
  templateMarginCents,
  templatesForMode,
} from '../../lib/costTemplates.js';
import { formatCurrency } from '../../lib/formatting/money.js';

/**
 * Quick-assign cost templates to an Owner (fixed) and/or a job (per-job).
 * Templates flagged "preselect when assigning" start checked; which of them
 * apply depends on whether the scope is an Owner, a job, or both.
 */
export function AssignCostTemplatesModal({
  open,
  onClose,
  onSaved,
  owners = [],
  jobs = [],
  defaultOwnerId = '',
  defaultJobId = '',
  mode = 'auto', // 'auto' | 'owner' | 'job' | 'all'
}) {
  const [ownerId, setOwnerId] = useState(defaultOwnerId);
  const [jobId, setJobId] = useState(defaultJobId);
  const [selected, setSelected] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [resultMsg, setResultMsg] = useState('');

  // Which templates are offered: a dedicated Owner/job scope narrows the list,
  // otherwise everything is assignable and the user picks the scope here.
  const listMode = mode === 'owner' || mode === 'job' ? mode : 'all';

  // Which start checked: when we arrive with a job (or Owner) already in hand,
  // preselect only the defaults that fit it, so nothing demands a second scope.
  const defaultsMode = defaultJobId ? 'job' : defaultOwnerId ? 'owner' : listMode;

  const available = useMemo(() => templatesForMode(templates, listMode), [templates, listMode]);

  useEffect(() => {
    if (!open) return;
    setOwnerId(defaultOwnerId || '');
    setJobId(defaultJobId || '');
    setError('');
    setResultMsg('');
    let cancelled = false;
    setLoading(true);
    listCostTemplates({ active: true })
      .then((rows) => {
        if (cancelled) return;
        setTemplates(rows);
        setSelected(defaultTemplateIds(templatesForMode(rows, listMode), defaultsMode));
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Could not load cost templates.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, defaultOwnerId, defaultJobId, listMode, defaultsMode]);

  const toggle = (id) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const selectedTemplates = available.filter((t) => selected.includes(t.id));
  const needsOwner = selectedTemplates.some((t) => t.cost_type === 'fixed');
  const needsJob = selectedTemplates.some((t) => t.cost_type === 'per_job');
  const selectedOwner =
    owners.find((o) => o.id === ownerId) ||
    owners.find((o) => o.id === jobs.find((j) => j.id === jobId)?.owner_id);
  const dealType = selectedOwner?.deal_type || null;

  const submit = async () => {
    setError('');
    setResultMsg('');
    if (!selected.length) return setError('Select at least one cost template.');
    if (needsOwner && !ownerId) return setError('Select an Owner for fixed costs.');
    if (needsJob && !jobId) return setError('Select a job for per-job costs.');

    setSaving(true);
    try {
      const { createdCount, skippedCount } = await applyCostTemplates(selectedTemplates, {
        ownerId: ownerId || null,
        jobId: jobId || null,
        dealType,
      });
      setResultMsg(
        `Done — ${createdCount} created, ${skippedCount} already present (skipped).`,
      );
      onSaved?.();
      if (createdCount > 0 && skippedCount === 0) onClose?.();
    } catch (err) {
      setError(err.message || 'Could not assign costs.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Assign cost templates"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn--secondary" onClick={onClose} disabled={saving}>
            Close
          </button>
          <button className="btn btn--primary" onClick={submit} disabled={saving}>
            {saving ? 'Assigning…' : 'Assign selected'}
          </button>
        </>
      }
    >
      {error ? <div className="form-error">{error}</div> : null}
      {resultMsg ? <div className="form-success">{resultMsg}</div> : null}

      <p className="muted text-sm" style={{ marginTop: 0 }}>
        Templates include both owner-quoted and internal actual amounts. Existing matching
        costs on the same Owner/job are skipped.
      </p>

      <div className="form-grid">
        {needsOwner || mode === 'owner' || mode === 'all' || mode === 'auto' ? (
          <Field label="Owner" htmlFor="act-owner" required={needsOwner}>
            <Select
              id="act-owner"
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              placeholder="Select owner"
              options={owners.map((o) => ({ value: o.id, label: o.display_name }))}
              disabled={Boolean(defaultOwnerId)}
            />
          </Field>
        ) : null}
        {needsJob || mode === 'job' || mode === 'all' || mode === 'auto' ? (
          <Field label="Job" htmlFor="act-job" required={needsJob}>
            <Select
              id="act-job"
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              placeholder="Select job"
              options={jobs.map((j) => ({
                value: j.id,
                label: `${j.employer_name}${j.owner?.display_name ? ` — ${j.owner.display_name}` : ''}`,
              }))}
              disabled={Boolean(defaultJobId)}
            />
          </Field>
        ) : null}
      </div>

      <div className="mt-8" style={{ display: 'grid', gap: 8 }}>
        {loading ? <p className="muted text-sm">Loading templates…</p> : null}
        {!loading && !available.length ? (
          <p className="muted text-sm">
            No {listMode === 'owner' ? 'fixed' : listMode === 'job' ? 'per-job' : ''} cost templates
            yet. Create one on the Costs page first.
          </p>
        ) : null}
        {available.map((t) => {
          const checked = selected.includes(t.id);
          return (
            <label
              key={t.id}
              className="row-cost-templates"
              style={{
                alignItems: 'flex-start',
                gap: 10,
                padding: '10px 12px',
                border: '1px solid var(--border, #ddd)',
                borderRadius: 8,
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(t.id)}
                style={{ marginTop: 3 }}
              />
              <span>
                <strong>{t.name}</strong>
                <span className="muted text-sm" style={{ display: 'block' }}>
                  {t.cost_type === 'fixed' ? 'Fixed cost' : 'Per-job cost'} · {t.cadence}
                </span>
                <span className="text-sm" style={{ display: 'block' }}>
                  Owner-quoted {formatCurrency(quotedCentsForDeal(t, dealType))} · Actual{' '}
                  {formatCurrency(t.actual_amount_cents)} · Margin{' '}
                  {formatCurrency(templateMarginCents(t, dealType))}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      {selectedTemplates.length ? (
        <p className="muted text-xs mt-8">
          Assigning: {selectedTemplates.map((t) => costTemplateLabel(t)).join(' · ')}
        </p>
      ) : null}
    </Modal>
  );
}

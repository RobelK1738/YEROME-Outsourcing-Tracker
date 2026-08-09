import { useState } from 'react';
import { useAsync } from '../../hooks/useAsync.js';
import { listTaxSettings, updateTaxSettings } from '../../lib/data/taxSettings.js';
import { getBusinessSettings, updateBusinessSettings } from '../../lib/data/businessSettings.js';
import { PageHeader } from '../../components/ui/PageHeader.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Field, TextInput } from '../../components/ui/Field.jsx';
import { Loading } from '../../components/ui/Loading.jsx';
import { ErrorState } from '../../components/ui/ErrorState.jsx';
import { Disclaimer } from '../../components/ui/Disclaimer.jsx';
import {
  FILING_STATUS_LABELS,
  DEFAULT_TAX_YEAR,
  DEFAULT_SAFETY_RESERVE_RATE,
  DEFAULT_COMMISSION_RATE,
  DEAL_TYPE_LABELS,
  DEAL_TYPE_HINTS,
  DEAL_OWNER_SHARE,
  DEAL_MIDDLE_SHARE,
  DEAL_YEROME_SHARE,
  DEFAULT_GANG_RESERVE_RATE,
  DEFAULT_GANG_CUT_RATE,
} from '../../lib/constants.js';
import { formatCurrency, formatPercent, dollarsToCents, centsToDollars } from '../../lib/formatting/money.js';

export default function SettingsPage() {
  const { data: settings, loading, error, refresh } = useAsync(() => listTaxSettings(DEFAULT_TAX_YEAR), []);
  const {
    data: biz,
    loading: bizLoading,
    error: bizError,
    refresh: refreshBiz,
  } = useAsync(() => getBusinessSettings(), []);
  const [edit, setEdit] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [gangForm, setGangForm] = useState(null);
  const [gangSaving, setGangSaving] = useState(false);
  const [gangError, setGangError] = useState('');

  const openEdit = (row) => {
    setEdit(row);
    setForm({
      ssRate: String(row.social_security_rate * 100),
      ssBase: String(centsToDollars(row.social_security_wage_base_cents)),
      medRate: String(row.medicare_rate * 100),
      addlMedRate: String(row.additional_medicare_rate * 100),
      addlMedThreshold: String(centsToDollars(row.additional_medicare_threshold_cents)),
      stateRate: String(row.state_income_tax_rate * 100),
    });
    setFormError('');
  };

  const save = async () => {
    setFormError('');
    setSaving(true);
    try {
      await updateTaxSettings(DEFAULT_TAX_YEAR, edit.filing_status, {
        // Standard deduction is unused — taxable income = projected gross.
        standard_deduction_cents: 0,
        social_security_rate: Number(form.ssRate) / 100,
        social_security_wage_base_cents: dollarsToCents(form.ssBase),
        medicare_rate: Number(form.medRate) / 100,
        additional_medicare_rate: Number(form.addlMedRate) / 100,
        additional_medicare_threshold_cents: dollarsToCents(form.addlMedThreshold),
        state_income_tax_rate: Number(form.stateRate) / 100,
      });
      setEdit(null);
      refresh();
    } catch (err) {
      setFormError(err.message || 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    { key: 'filing', header: 'Filing Status', mobile: 'title', render: (r) => <strong>{FILING_STATUS_LABELS[r.filing_status]}</strong> },
    { key: 'ss', header: 'Social Security', hideOnMobile: true, render: (r) => `${formatPercent(r.social_security_rate)} to ${formatCurrency(r.social_security_wage_base_cents)}` },
    { key: 'med', header: 'Medicare', hideOnMobile: true, render: (r) => formatPercent(r.medicare_rate) },
    { key: 'addl', header: 'Add’l Medicare', hideOnMobile: true, render: (r) => `${formatPercent(r.additional_medicare_rate)} over ${formatCurrency(r.additional_medicare_threshold_cents)}` },
    { key: 'state', header: 'State tax', mobile: 'amount', render: (r) => formatPercent(r.state_income_tax_rate) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      mobile: 'actions',
      render: (r) => (
        <button className="btn btn--secondary btn--sm" onClick={() => openEdit(r)}>
          Edit
        </button>
      ),
    },
  ];

  // Every Owner files single, so that is the only bracket table worth showing.
  const singleBrackets = (settings || []).find((s) => s.filing_status === 'single')?.federal_brackets || [];

  return (
    <>
      <PageHeader title="Settings" subtitle={`Tax year ${DEFAULT_TAX_YEAR} configuration and business defaults.`} />

      {loading ? (
        <Loading label="Loading settings…" />
      ) : error ? (
        <ErrorState error={error} onRetry={refresh} />
      ) : (
        <>
          <Card
            title={`${DEFAULT_TAX_YEAR} Tax Configuration`}
            subtitle="Gross wages are treated as fully taxable. Brackets and FICA rates still apply by filing status."
            padded={false}
          >
            <DataTable columns={columns} rows={settings} getRowKey={(r) => r.filing_status} />
          </Card>

          <Card
            title="Federal brackets (read-only)"
            subtitle="Progressive marginal brackets applied to combined Owner gross wages. Every Owner files single."
          >
            <div className="breakdown">
              {(singleBrackets || []).map((b, i) => (
                <div className="breakdown__row" key={i}>
                  <span className="breakdown__label">
                    {formatCurrency(b.min)} – {b.max == null ? 'and up' : formatCurrency(b.max)}
                  </span>
                  <span className="breakdown__value">{formatPercent(b.rate)}</span>
                </div>
              ))}
            </div>
            <Disclaimer />
          </Card>

          <Card title="Partnerships (sheet model)">
            <dl className="kv">
              <dt>Owner-quoted money story</dt>
              <dd>Gross → taxes → after-tax → quoted costs → net → split</dd>
              <dt>YEROME take-home</dt>
              <dd>After-tax − actual costs − owner share − middle man − Gang Cut</dd>
              <dt>{DEAL_TYPE_LABELS.miki_wohabe}</dt>
              <dd>
                Owner {formatPercent(DEAL_OWNER_SHARE.miki_wohabe)} / YEROME{' '}
                {formatPercent(DEAL_YEROME_SHARE.miki_wohabe)}. {DEAL_TYPE_HINTS.miki_wohabe}
              </dd>
              <dt>{DEAL_TYPE_LABELS.three_way}</dt>
              <dd>
                Owner {formatPercent(DEAL_OWNER_SHARE.three_way)} / Middle man{' '}
                {formatPercent(DEAL_MIDDLE_SHARE.three_way)} / YEROME{' '}
                {formatPercent(DEAL_YEROME_SHARE.three_way)}
              </dd>
              <dt>{DEAL_TYPE_LABELS.no_middle}</dt>
              <dd>
                Owner {formatPercent(DEAL_OWNER_SHARE.no_middle)} / YEROME{' '}
                {formatPercent(DEAL_YEROME_SHARE.no_middle)}. {DEAL_TYPE_HINTS.no_middle}
              </dd>
              <dt>Default commission basis</dt>
              <dd>{formatPercent(DEFAULT_COMMISSION_RATE)} of referred net (2-way referrals only)</dd>
              <dt>Owner Safety Reserve</dt>
              <dd>{formatPercent(DEFAULT_SAFETY_RESERVE_RATE)} of Owner share (planning tip · owners see this)</dd>
              <dt>Default pay periods / year</dt>
              <dd>26 (biweekly)</dd>
            </dl>
            <p className="muted text-sm mt-8">
              Owners only see quoted costs as “costs.” Actual amounts and Gang Cut are YEROME-only.
            </p>
          </Card>

          <Card
            title="Gang Cut (YEROME-only)"
            subtitle="Applies on every deal. Owners never see this. Formula: after-tax × (1 − safety haircut) × cut rate."
          >
            {bizLoading ? (
              <p className="muted text-sm">Loading Gang Cut rates…</p>
            ) : bizError ? (
              <p className="form-error">{bizError.message || 'Could not load Gang Cut settings.'}</p>
            ) : (
              <>
                {gangError ? <div className="form-error">{gangError}</div> : null}
                <div className="form-grid">
                  <Field
                    label="Safety haircut %"
                    htmlFor="g-reserve"
                    hint={`Default ${formatPercent(DEFAULT_GANG_RESERVE_RATE)}. Taken from after-tax before the cut.`}
                  >
                    <TextInput
                      id="g-reserve"
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={gangForm?.reserve ?? String((biz?.gang_reserve_rate ?? DEFAULT_GANG_RESERVE_RATE) * 100)}
                      onChange={(e) =>
                        setGangForm({
                          reserve: e.target.value,
                          cut: gangForm?.cut ?? String((biz?.gang_cut_rate ?? DEFAULT_GANG_CUT_RATE) * 100),
                        })
                      }
                    />
                  </Field>
                  <Field
                    label="Gang Cut %"
                    htmlFor="g-cut"
                    hint={`Default ${formatPercent(DEFAULT_GANG_CUT_RATE)} of the amount after the haircut.`}
                  >
                    <TextInput
                      id="g-cut"
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={gangForm?.cut ?? String((biz?.gang_cut_rate ?? DEFAULT_GANG_CUT_RATE) * 100)}
                      onChange={(e) =>
                        setGangForm({
                          reserve: gangForm?.reserve ?? String((biz?.gang_reserve_rate ?? DEFAULT_GANG_RESERVE_RATE) * 100),
                          cut: e.target.value,
                        })
                      }
                    />
                  </Field>
                </div>
                <div className="row" style={{ marginTop: 12 }}>
                  <button
                    className="btn btn--primary"
                    disabled={gangSaving || !gangForm}
                    onClick={async () => {
                      setGangError('');
                      const reserve = Number(gangForm.reserve) / 100;
                      const cut = Number(gangForm.cut) / 100;
                      if (!(reserve >= 0 && reserve <= 1) || !(cut >= 0 && cut <= 1)) {
                        setGangError('Rates must be between 0 and 100%.');
                        return;
                      }
                      setGangSaving(true);
                      try {
                        await updateBusinessSettings({ gang_reserve_rate: reserve, gang_cut_rate: cut });
                        setGangForm(null);
                        refreshBiz();
                      } catch (err) {
                        setGangError(err.message || 'Could not save Gang Cut rates.');
                      } finally {
                        setGangSaving(false);
                      }
                    }}
                  >
                    {gangSaving ? 'Saving…' : 'Save Gang Cut rates'}
                  </button>
                </div>
              </>
            )}
          </Card>
        </>
      )}

      <Modal
        open={Boolean(edit)}
        title={edit ? `Edit ${FILING_STATUS_LABELS[edit.filing_status]} — ${DEFAULT_TAX_YEAR}` : ''}
        onClose={() => setEdit(null)}
        footer={
          <>
            <button className="btn btn--secondary" onClick={() => setEdit(null)} disabled={saving}>
              Cancel
            </button>
            <button className="btn btn--primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        {formError ? <div className="form-error">{formError}</div> : null}
        {form ? (
          <div className="form-grid">
            <Field label="Social Security rate %" htmlFor="s-ss">
              <TextInput id="s-ss" type="number" step="0.01" value={form.ssRate} onChange={(e) => setForm({ ...form, ssRate: e.target.value })} />
            </Field>
            <Field label="SS wage base ($)" htmlFor="s-base">
              <TextInput id="s-base" type="number" step="1" value={form.ssBase} onChange={(e) => setForm({ ...form, ssBase: e.target.value })} />
            </Field>
            <Field label="Medicare rate %" htmlFor="s-med">
              <TextInput id="s-med" type="number" step="0.01" value={form.medRate} onChange={(e) => setForm({ ...form, medRate: e.target.value })} />
            </Field>
            <Field label="Add’l Medicare rate %" htmlFor="s-amed">
              <TextInput id="s-amed" type="number" step="0.01" value={form.addlMedRate} onChange={(e) => setForm({ ...form, addlMedRate: e.target.value })} />
            </Field>
            <Field label="Add’l Medicare threshold ($)" htmlFor="s-athr">
              <TextInput id="s-athr" type="number" step="1" value={form.addlMedThreshold} onChange={(e) => setForm({ ...form, addlMedThreshold: e.target.value })} />
            </Field>
            <Field label="State income tax rate %" htmlFor="s-state">
              <TextInput id="s-state" type="number" step="0.01" value={form.stateRate} onChange={(e) => setForm({ ...form, stateRate: e.target.value })} />
            </Field>
          </div>
        ) : null}
      </Modal>
    </>
  );
}

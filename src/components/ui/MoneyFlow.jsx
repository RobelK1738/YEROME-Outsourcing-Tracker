// One-glance money story used across the YEROME and Owner portals.

import { formatCurrency } from '../../lib/formatting/money.js';

export function MoneyFlow({
  title = 'Where the money goes',
  subtitle,
  periodLabel = 'Annual',
  grossCents,
  cuts = [],
  remainingCents,
  remainingLabel = 'Estimated remaining',
  details,
  footer,
}) {
  return (
    <section className="money-flow card">
      <div className="card__header">
        <div>
          <h3 className="card__title">{title}</h3>
          {subtitle ? <p className="card__subtitle">{subtitle}</p> : null}
        </div>
        {periodLabel ? <span className="money-flow__period">{periodLabel}</span> : null}
      </div>
      <div className="card__body">
        {grossCents != null ? (
          <div className="money-flow__row money-flow__row--gross">
            <span className="money-flow__label">Gross wages</span>
            <span className="money-flow__value">{formatCurrency(grossCents)}</span>
          </div>
        ) : null}
        <ul className="money-flow__cuts">
          {cuts.map((cut) => (
            <li
              key={cut.label}
              className={`money-flow__row money-flow__row--cut ${cut.tone === 'emphasis' ? 'money-flow__row--emphasis' : ''}`}
            >
              <span className="money-flow__label">
                {cut.label}
                {cut.hint ? <span className="money-flow__hint">{cut.hint}</span> : null}
              </span>
              <span className="money-flow__value money-flow__value--cut">
                {cut.sign === '+' ? '+ ' : '− '}
                {formatCurrency(cut.cents)}
              </span>
            </li>
          ))}
        </ul>
        {remainingCents != null ? (
          <div className="money-flow__row money-flow__row--remain">
            <span className="money-flow__label">{remainingLabel}</span>
            <span className="money-flow__value money-flow__value--remain">
              {formatCurrency(remainingCents)}
            </span>
          </div>
        ) : null}
        {footer ? <div className="money-flow__footer">{footer}</div> : null}
        {details ? <div className="money-flow__details">{details}</div> : null}
      </div>
    </section>
  );
}

/** Shared tax component disclosure (YEROME + Owner portals). */
export function TaxDetails({
  tax,
  stateLabel,
  periodLabel = 'Annual',
  hint = 'Estimated from combined Owner wages, then allocated to this period.',
}) {
  if (!tax) return null;
  const rows = [
    ['Federal income tax', tax.federalIncomeTaxCents],
    ['Social Security', tax.socialSecurityCents],
    ['Medicare', tax.medicareCents],
    ['Additional Medicare', tax.additionalMedicareCents],
    [`State (${stateLabel || '—'})`, tax.stateTaxCents],
  ];
  return (
    <details className="details-block">
      <summary>Tax breakdown ({periodLabel.toLowerCase()})</summary>
      <div className="breakdown">
        {hint ? <p className="muted text-sm" style={{ margin: '0 0 8px' }}>{hint}</p> : null}
        {rows.map(([label, cents]) => (
          <div className="breakdown__row" key={label}>
            <span className="breakdown__label">{label}</span>
            <span className="breakdown__value">{formatCurrency(cents || 0)}</span>
          </div>
        ))}
        <div className="breakdown__row breakdown__row--total">
          <span className="breakdown__label">Total estimated taxes</span>
          <span className="breakdown__value">{formatCurrency(tax.totalTaxCents || 0)}</span>
        </div>
      </div>
    </details>
  );
}

/**
 * YEROME view: one card telling the whole story for a single period —
 * gross → taxes → quoted costs → net, then net → owner / middle man / YEROME.
 * YEROME take-home = after-tax − actual costs − owner paper − middle paper − Gang Cut.
 */
export function MoneyStory({
  title = 'Money flow',
  subtitle,
  periodLabel = 'Annual',
  grossCents,
  cuts = [],
  netCents,
  netLabel = 'Owner-quoted net profit',
  splitLabel = 'Split of net profit',
  ownerCutCents,
  commissionCents = 0,
  opsDealShareCents,
  costMarginCents = 0,
  gangCutCents = 0,
  opsCutCents,
  ownerShareRate,
  details,
  footer,
}) {
  const dealShare = opsDealShareCents != null ? opsDealShareCents : opsCutCents;
  const margin = costMarginCents || 0;
  const gang = gangCutCents || 0;

  return (
    <section className="money-flow card">
      <div className="card__header">
        <div>
          <h3 className="card__title">{title}</h3>
          {subtitle ? <p className="card__subtitle">{subtitle}</p> : null}
        </div>
        {periodLabel ? <span className="money-flow__period">{periodLabel}</span> : null}
      </div>
      <div className="card__body">
        {grossCents != null ? (
          <div className="money-flow__row money-flow__row--gross">
            <span className="money-flow__label">Gross wages</span>
            <span className="money-flow__value">{formatCurrency(grossCents)}</span>
          </div>
        ) : null}
        <ul className="money-flow__cuts">
          {cuts.map((cut) => (
            <li key={cut.label} className="money-flow__row money-flow__row--cut">
              <span className="money-flow__label">
                {cut.label}
                {cut.hint ? <span className="money-flow__hint">{cut.hint}</span> : null}
              </span>
              <span className="money-flow__value money-flow__value--cut">
                {cut.sign === '+' ? '+ ' : '− '}
                {formatCurrency(cut.cents)}
              </span>
            </li>
          ))}
        </ul>
        <div className="money-flow__row money-flow__row--subtotal">
          <span className="money-flow__label">{netLabel}</span>
          <span className="money-flow__value">{formatCurrency(netCents)}</span>
        </div>
        <ul className="money-flow__cuts">
          <li className="money-flow__row money-flow__row--cut">
            <span className="money-flow__label">
              Owner share
              <span className="money-flow__hint">{Math.round((ownerShareRate || 0) * 100)}% of owner-quoted net</span>
            </span>
            <span className="money-flow__value money-flow__value--cut">
              {margin >= 0 ? '+ ' : '− '}
              {formatCurrency(ownerCutCents)}
            </span>
          </li>
          {commissionCents > 0 ? (
            <li className="money-flow__row money-flow__row--cut">
              <span className="money-flow__label">
                Middle man / commission
                <span className="money-flow__hint">From referral on owner-quoted net</span>
              </span>
              <span className="money-flow__value">{formatCurrency(commissionCents)}</span>
            </li>
          ) : null}
          {margin !== 0 ? (
            <li className="money-flow__row money-flow__row--cut">
              <span className="money-flow__label">
                Cost Margin
                <span className="money-flow__hint">Quoted − Actual</span>
              </span>
              <span className="money-flow__value money-flow__value--cut">
                {margin >= 0 ? '+ ' : '− '}
                {formatCurrency(Math.abs(margin))}
              </span>
            </li>
          ) : null}
          {gang !== 0 ? (
            <li className="money-flow__row money-flow__row--cut">
              <span className="money-flow__label">
                Gang Cut
                <span className="money-flow__hint">Royalty Fee</span>
              </span>
              <span className="money-flow__value money-flow__value--cut">
                − {formatCurrency(gang)}
              </span>
            </li>
          ) : null}
        </ul>
        <div className="money-flow__row money-flow__row--remain">
          <span className="money-flow__label">
            YEROME take-home
            <span className="money-flow__hint">Paper share + cost margin − Gang Cut</span>
          </span>
          <span className="money-flow__value money-flow__value--remain">{formatCurrency(opsCutCents)}</span>
        </div>
        {footer ? <div className="money-flow__footer">{footer}</div> : null}
        {details ? <div className="money-flow__details">{details}</div> : null}
      </div>
    </section>
  );
}

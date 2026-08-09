import { StatusBadge } from './Badge.jsx';
import { formatCurrency } from '../../lib/formatting/money.js';

/** Tappable job card for the Owner phone home and jobs list. */
export function JobCard({ job, paycheck, onClick }) {
  return (
    <button type="button" className="job-card" onClick={onClick}>
      <div className="job-card__top">
        <strong className="job-card__name">{job.employer_name}</strong>
        <StatusBadge status={job.status} />
      </div>
      {job.role_title ? <div className="job-card__role">{job.role_title}</div> : null}
      <div className="job-card__keep">
        <span className="job-card__keep-label">You keep / paycheck</span>
        <span className="job-card__keep-value">
          {paycheck ? formatCurrency(paycheck.ownerCutCents) : '—'}
        </span>
      </div>
      {paycheck ? (
        <div className="job-card__meta">
          Set aside {formatCurrency(paycheck.estimatedTaxCents)} tax
          {paycheck.safetyReserveCents
            ? ` · ${formatCurrency(paycheck.safetyReserveCents)} reserve`
            : ''}
        </div>
      ) : null}
    </button>
  );
}

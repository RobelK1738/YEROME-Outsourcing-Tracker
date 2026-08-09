// Compact metric card used across dashboards. `tone` optionally colors the
// value for financial emphasis (positive/negative/muted).

export function StatCard({ label, value, hint, tone = 'default', emphasis = false }) {
  return (
    <div className={`stat ${emphasis ? 'stat--emphasis' : ''}`}>
      <span className="stat__label">{label}</span>
      <span className={`stat__value stat__value--${tone}`}>{value}</span>
      {hint ? <span className="stat__hint">{hint}</span> : null}
    </div>
  );
}

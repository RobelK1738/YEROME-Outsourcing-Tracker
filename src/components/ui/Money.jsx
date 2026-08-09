import { formatCurrency } from '../../lib/formatting/money.js';

// Renders integer cents as consistent currency. `tone` can highlight negatives.
export function Money({ cents, tone, className = '' }) {
  const value = Number(cents) || 0;
  const resolvedTone = tone || (value < 0 ? 'negative' : 'default');
  return <span className={`money money--${resolvedTone} ${className}`}>{formatCurrency(value)}</span>;
}

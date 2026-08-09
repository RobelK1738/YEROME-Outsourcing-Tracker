import {
  OWNER_STATUS_LABELS,
  JOB_STATUS_LABELS,
} from '../../lib/constants.js';

// Maps a status string to a semantic color class.
const TONE_BY_STATUS = {
  active: 'ok',
  pending: 'info',
  paused: 'warn',
  inactive: 'warn',
  ended: 'muted',
  archived: 'muted',
};

export function Badge({ children, tone = 'muted' }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function StatusBadge({ status, kind = 'job' }) {
  const labels = kind === 'owner' ? OWNER_STATUS_LABELS : JOB_STATUS_LABELS;
  const tone = TONE_BY_STATUS[status] || 'muted';
  return <Badge tone={tone}>{labels[status] || status}</Badge>;
}

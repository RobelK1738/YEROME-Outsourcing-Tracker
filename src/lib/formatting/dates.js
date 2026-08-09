// Date helpers for pay schedules. All dates are date-only ISO strings
// ("YYYY-MM-DD"). Parsing/formatting is done in UTC to avoid timezone/DST drift.

export function parseISO(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

export function toISO(dt) {
  return dt.toISOString().slice(0, 10);
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(iso, days) {
  const dt = parseISO(iso);
  dt.setUTCDate(dt.getUTCDate() + days);
  return toISO(dt);
}

export function addMonths(iso, months) {
  const dt = parseISO(iso);
  const day = dt.getUTCDate();
  dt.setUTCDate(1);
  dt.setUTCMonth(dt.getUTCMonth() + months);
  // Clamp to the last valid day of the resulting month.
  const daysInMonth = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(day, daysInMonth));
  return toISO(dt);
}

/**
 * Generate `count` pay dates starting at `startISO` for a pay frequency.
 *   weekly      -> every 7 days
 *   biweekly    -> every 14 days
 *   semimonthly -> twice a month (start day and +15 days)
 *   monthly     -> same day each month (clamped)
 */
export function generatePayDates(startISO, count, frequency) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    let d;
    if (frequency === 'weekly') d = addDays(startISO, i * 7);
    else if (frequency === 'monthly') d = addMonths(startISO, i);
    else if (frequency === 'semimonthly') {
      const base = addMonths(startISO, Math.floor(i / 2));
      d = i % 2 === 0 ? base : addDays(base, 15);
    } else d = addDays(startISO, i * 14); // biweekly (default)
    out.push(d);
  }
  return out;
}

const dateFmt = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

export function formatDate(iso) {
  if (!iso) return '—';
  try {
    return dateFmt.format(parseISO(iso));
  } catch {
    return iso;
  }
}

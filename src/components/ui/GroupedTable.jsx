// Collapsible hierarchy for list pages that would otherwise dump hundreds of
// rows (costs per job per owner, paychecks per job per owner). Each group shows
// its own roll-up totals so the collapsed view is still useful.

import { useState } from 'react';
import { EmptyState } from './EmptyState.jsx';

function GroupNode({ group, level }) {
  const nested = group.groups || [];
  // Held in state so a parent re-render (filter change, modal open, refresh)
  // does not slam every expanded group shut.
  const [open, setOpen] = useState(Boolean(group.defaultOpen));
  return (
    <details
      className={`group group--l${level}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="group__summary">
        <span className="group__marker" aria-hidden="true" />
        <span className="group__head">
          <span className="group__label">{group.label}</span>
          {group.meta ? <span className="group__meta">{group.meta}</span> : null}
        </span>
        {group.totals?.length ? (
          <span className="group__totals">
            {group.totals.map((total) => (
              <span
                className={`group__total ${total.hideOnMobile ? 'hide-mobile' : ''}`}
                key={total.label}
              >
                <span className="group__total-label">{total.label}</span>
                <span className="group__total-value">{total.value}</span>
              </span>
            ))}
          </span>
        ) : null}
      </summary>
      <div className="group__body">
        {nested.map((child) => (
          <GroupNode key={child.key} group={child} level={level + 1} />
        ))}
        {group.children}
      </div>
    </details>
  );
}

export function GroupedTable({ groups = [], emptyTitle, emptyMessage, emptyAction }) {
  if (!groups.length) {
    return <EmptyState title={emptyTitle || 'No records'} message={emptyMessage} action={emptyAction} />;
  }
  return (
    <div className="group-list">
      {groups.map((group) => (
        <GroupNode key={group.key} group={group} level={1} />
      ))}
    </div>
  );
}

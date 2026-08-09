// Responsive data table.
//
// Wide screens render a normal table. At phone widths the same data renders as a
// compact list instead, because a stacked "label: value" card per row makes long
// lists unscannable. Columns opt into the compact layout with `mobile`:
//
//   'title'   → first line, left (bold)
//   'amount'  → first line, right (bold, tabular)
//   'meta'    → second line, left (joined with ·)
//   'badge'   → second line, right
//   'actions' → footer row of the list item
//   'detail'  → label/value pair under the headline (the default)
//
// Columns with `hideOnMobile` are dropped entirely. Tables that annotate nothing
// keep the previous behaviour: headline + label/value details.
//
// columns: [{ key, header, render?(row), align?, mono?, hideOnMobile?, mobile? }]

import { Fragment, useState } from 'react';
import { EmptyState } from './EmptyState.jsx';
import { useIsCompact } from '../../hooks/useMediaQuery.js';

const MOBILE_PAGE_SIZE = 25;

function cellValue(col, row) {
  return col.render ? col.render(row) : row[col.key];
}

// The compact list can add context a table header would otherwise carry
// ("Gross $1,923.08"), without that wording leaking into the desktop column.
function mobileCellValue(col, row) {
  if (col.renderMobile) return col.renderMobile(row);
  return cellValue(col, row);
}

function isEmptyCell(value) {
  return value == null || value === '' || value === '—';
}

function CompactList({ columns, rows, getRowKey, onRowClick, mobilePageSize, mobileGroup }) {
  const pageSize = mobilePageSize || MOBILE_PAGE_SIZE;
  const [visible, setVisible] = useState(pageSize);

  const shown = columns.filter((col) => !col.hideOnMobile);
  const annotated = shown.some((col) => col.mobile);
  const titleCol = shown.find((col) => col.mobile === 'title') || (annotated ? null : shown[0]);
  const amountCol = shown.find((col) => col.mobile === 'amount');
  const badgeCol = shown.find((col) => col.mobile === 'badge');
  const metaCols = shown.filter((col) => col.mobile === 'meta');
  const actionCols = shown.filter((col) => col.mobile === 'actions');
  const detailCols = shown.filter(
    (col) => col !== titleCol && !['title', 'amount', 'badge', 'meta', 'actions'].includes(col.mobile),
  );

  const visibleRows = rows.slice(0, visible);
  const clickable = Boolean(onRowClick);

  return (
    <>
      <ul className={`m-list ${clickable ? 'm-list--clickable' : ''}`}>
        {visibleRows.map((row, index) => {
          const key = getRowKey ? getRowKey(row) : row.id;
          const group = mobileGroup ? mobileGroup(row) : null;
          const previousGroup = mobileGroup && index > 0 ? mobileGroup(visibleRows[index - 1]) : null;
          const startsGroup = group && (index === 0 || group.key !== previousGroup?.key);
          const meta = metaCols.map((col) => mobileCellValue(col, row)).filter((v) => !isEmptyCell(v));
          const details = detailCols
            .map((col) => ({ col, value: mobileCellValue(col, row) }))
            .filter(({ value }) => !isEmptyCell(value));
          const amount = amountCol ? mobileCellValue(amountCol, row) : null;
          const badge = badgeCol ? mobileCellValue(badgeCol, row) : null;
          // With nothing else on the second line, a lone badge just wastes a row.
          const badgeInline = !isEmptyCell(badge) && meta.length === 0;

          return (
            <Fragment key={key}>
            {startsGroup ? (
              <li className="m-list__group" aria-hidden="true">{group.label}</li>
            ) : null}
            <li
              className="m-row"
              onClick={clickable ? () => onRowClick(row) : undefined}
              onKeyDown={
                clickable
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onRowClick(row);
                      }
                    }
                  : undefined
              }
              tabIndex={clickable ? 0 : undefined}
              role={clickable ? 'button' : undefined}
            >
              <div className="m-row__head">
                <div className="m-row__title">{titleCol ? mobileCellValue(titleCol, row) : null}</div>
                {badgeInline ? <div className="m-row__badge">{badge}</div> : null}
                {!isEmptyCell(amount) ? <div className="m-row__amount">{amount}</div> : null}
                {clickable ? (
                  <span className="m-row__chevron" aria-hidden="true">›</span>
                ) : null}
              </div>

              {meta.length ? (
                <div className="m-row__sub">
                  <div className="m-row__meta">
                    {meta.map((value, i) => (
                      <span key={i} className="m-row__meta-item">
                        {value}
                      </span>
                    ))}
                  </div>
                  {!isEmptyCell(badge) ? <div className="m-row__badge">{badge}</div> : null}
                </div>
              ) : null}

              {details.length ? (
                <dl className="m-row__details">
                  {details.map(({ col, value }) => (
                    <div className="m-row__detail" key={col.key + String(col.header)}>
                      <dt>{col.header}</dt>
                      <dd
                        className={col.mono ? 'mono' : ''}
                        style={{ textAlign: 'end' }}
                      >
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}

              {actionCols.length ? (
                <div className="m-row__actions">
                  {actionCols.map((col) => (
                    <div key={col.key} className="m-row__actions-group">
                      {mobileCellValue(col, row)}
                    </div>
                  ))}
                </div>
              ) : null}
            </li>
            </Fragment>
          );
        })}
      </ul>

      {rows.length > visible ? (
        <div className="m-list__more">
          <button
            type="button"
            className="btn btn--secondary btn--block"
            onClick={() => setVisible((v) => v + pageSize)}
          >
            Show {Math.min(pageSize, rows.length - visible)} more ({rows.length - visible} left)
          </button>
        </div>
      ) : null}
    </>
  );
}

export function DataTable({
  columns,
  rows,
  getRowKey,
  onRowClick,
  emptyTitle,
  emptyMessage,
  emptyAction,
  mobilePageSize,
  mobileGroup,
}) {
  const compact = useIsCompact();

  if (!rows || rows.length === 0) {
    return <EmptyState title={emptyTitle || 'No records'} message={emptyMessage} action={emptyAction} />;
  }

  if (compact) {
    return (
      <CompactList
        columns={columns}
        rows={rows}
        getRowKey={getRowKey}
        onRowClick={onRowClick}
        mobilePageSize={mobilePageSize}
        mobileGroup={mobileGroup}
      />
    );
  }

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`${col.align ? `ta-${col.align}` : ''} ${col.hideOnMobile ? 'hide-mobile' : ''}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = getRowKey ? getRowKey(row) : row.id;
            const clickable = Boolean(onRowClick);
            return (
              <tr
                key={key}
                className={clickable ? 'data-table__row--clickable' : ''}
                onClick={clickable ? () => onRowClick(row) : undefined}
                tabIndex={clickable ? 0 : undefined}
                onKeyDown={
                  clickable
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    data-label={col.header}
                    className={`${col.align ? `ta-${col.align}` : ''} ${col.mono ? 'mono' : ''} ${
                      col.hideOnMobile ? 'hide-mobile' : ''
                    }`}
                  >
                    {cellValue(col, row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

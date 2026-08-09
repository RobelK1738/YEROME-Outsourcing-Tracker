export function EmptyState({ title = 'Nothing here yet', message, action }) {
  return (
    <div className="state state--empty">
      <div className="state__icon" aria-hidden="true">
        ☐
      </div>
      <h3 className="state__title">{title}</h3>
      {message ? <p className="state__text">{message}</p> : null}
      {action ? <div className="state__action">{action}</div> : null}
    </div>
  );
}

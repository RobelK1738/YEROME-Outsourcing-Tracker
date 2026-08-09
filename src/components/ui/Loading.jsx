export function Loading({ label = 'Loading…', full = false }) {
  return (
    <div className={full ? 'state state--full' : 'state'} role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <p className="state__text">{label}</p>
    </div>
  );
}

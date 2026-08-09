// Friendly error surface. Shows a safe message; never renders raw stack traces
// or secrets to the browser.

function friendlyMessage(error) {
  if (!error) return 'Something went wrong.';
  const msg = typeof error === 'string' ? error : error.message || 'Something went wrong.';
  // Map a few common cases to clearer language.
  if (/not authorized|permission|rls|row-level/i.test(msg)) {
    return "You don't have access to this information.";
  }
  if (/failed to fetch|networkerror|network request failed/i.test(msg)) {
    return 'Could not reach the server. Check your connection and try again.';
  }
  return msg;
}

export function ErrorState({ error, onRetry, title = 'Unable to load' }) {
  return (
    <div className="state state--error" role="alert">
      <div className="state__icon" aria-hidden="true">
        !
      </div>
      <h3 className="state__title">{title}</h3>
      <p className="state__text">{friendlyMessage(error)}</p>
      {onRetry ? (
        <button type="button" className="btn btn--secondary" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

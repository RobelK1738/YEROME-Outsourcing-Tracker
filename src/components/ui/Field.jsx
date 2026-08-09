// Lightweight form primitives with labels, hints, and inline validation errors.

export function Field({ label, htmlFor, error, hint, required, children }) {
  return (
    <div className={`field ${error ? 'field--error' : ''}`}>
      {label ? (
        <label className="field__label" htmlFor={htmlFor}>
          {label}
          {required ? <span className="field__req" aria-hidden="true"> *</span> : null}
        </label>
      ) : null}
      {children}
      {hint && !error ? <p className="field__hint">{hint}</p> : null}
      {error ? <p className="field__error">{error}</p> : null}
    </div>
  );
}

export function TextInput({ id, ...props }) {
  return <input id={id} className="input" {...props} />;
}

export function Select({ id, options, placeholder, ...props }) {
  return (
    <select id={id} className="input" {...props}>
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

export function TextArea({ id, ...props }) {
  return <textarea id={id} className="input input--textarea" {...props} />;
}

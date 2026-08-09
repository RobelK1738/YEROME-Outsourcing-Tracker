import { TAX_DISCLAIMER } from '../../lib/constants.js';

export function Disclaimer({ text = TAX_DISCLAIMER }) {
  return (
    <p className="disclaimer" role="note">
      <span className="disclaimer__badge">Estimate</span>
      {text}
    </p>
  );
}

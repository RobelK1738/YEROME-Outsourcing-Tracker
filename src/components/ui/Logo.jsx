// Brand mark. Served from /public so the favicon and the in-app logo stay one
// file; the tile is decorative, so it is hidden from screen readers.

export function Logo({ size = 26, className = '' }) {
  return (
    <img
      src="/logo.svg"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={`logo ${className}`.trim()}
    />
  );
}

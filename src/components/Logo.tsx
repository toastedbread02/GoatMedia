import { Link } from 'react-router-dom';

export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" focusable="false" className="logo__mark">
      <path d="M10.6 12.4 22.6 17l-12 4.6z" fill="var(--accent)" />
      <path
        d="M11.4 10.9C10.2 8.4 8.2 7.2 5.9 7.5c1.4 1.7 2.2 3.7 2.4 5.6M19.9 10.6c.9-2.4 2.8-3.6 5.1-3.3.1 1.9-1.6 3.6-2.2 5.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Logo({ to = '/' }: { to?: string }) {
  return (
    <Link className="logo" to={to} aria-label="GoatMedia home">
      <LogoMark />
      <span className="logo__word">GoatMedia</span>
    </Link>
  );
}

interface LoaderProps {
  /** For light surfaces: dots take the accent colour instead of stage ink. */
  dark?: boolean;
  /** Screen-reader label. Leave out when a parent already announces loading. */
  label?: string;
  className?: string;
}

/**
 * Three dots: two sit still next to each other, the third circles them at a
 * constant speed. The motion is a single linear rotation, so the loop has no
 * seam, no easing and nothing else moving.
 */
export function Loader({ dark = false, label, className = '' }: LoaderProps) {
  return (
    <span
      className={`loader${dark ? ' loader--dark' : ''}${className ? ` ${className}` : ''}`}
      {...(label ? { role: 'status', 'aria-label': label } : { 'aria-hidden': true })}
    >
      <span className="loader__dot loader__dot--a" />
      <span className="loader__dot loader__dot--b" />
      <span className="loader__orbit">
        <span className="loader__dot" />
      </span>
    </span>
  );
}

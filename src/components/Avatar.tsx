const TONES = ['#6C7659', '#A45B39', '#6E657F', '#4F6E72', '#8A6A3F'];

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function toneFor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 997;
  return TONES[hash % TONES.length];
}

interface AvatarProps {
  displayName: string;
  username: string;
  avatarUrl?: string | null;
  size?: number;
  className?: string;
}

export function Avatar({ displayName, username, avatarUrl, size = 36, className = '' }: AvatarProps) {
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.34)) };
  if (avatarUrl) {
    return (
      <img
        className={`avatar ${className}`}
        style={style}
        src={avatarUrl}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
      />
    );
  }
  return (
    <span
      className={`avatar avatar--letters ${className}`}
      style={{ ...style, background: toneFor(username) }}
      aria-hidden="true"
    >
      {initials(displayName || username)}
    </span>
  );
}

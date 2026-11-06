import { useState } from 'react';

interface AvatarProps {
  user: { username: string; displayName: string; avatarUrl: string | null };
  size?: number;
  className?: string;
}

export function Avatar({ user, size = 38, className = '' }: AvatarProps) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) } as const;

  if (!user.avatarUrl || broken) {
    return (
      <span
        className={`avatar avatar--letter ${className}`}
        style={style}
        aria-hidden="true"
        title={user.displayName}
      >
        {user.displayName.slice(0, 1).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      className={`avatar ${className}`}
      style={style}
      src={user.avatarUrl}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setBroken(true)}
    />
  );
}

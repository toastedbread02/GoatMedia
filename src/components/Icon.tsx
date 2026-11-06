import type { ReactNode, SVGProps } from 'react';

export type IconName =
  | 'home'
  | 'trending'
  | 'users'
  | 'upload'
  | 'user'
  | 'search'
  | 'bell'
  | 'heart'
  | 'comment'
  | 'share'
  | 'more'
  | 'close'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'plus'
  | 'check'
  | 'alert'
  | 'flag'
  | 'eye-off'
  | 'trash'
  | 'settings'
  | 'logout'
  | 'link'
  | 'volume'
  | 'mute'
  | 'shield'
  | 'clock'
  | 'arrow-left'
  | 'edit'
  | 'play'
  | 'grid'
  | 'spark';

const paths: Record<IconName, ReactNode> = {
  home: (
    <>
      <path d="M4.5 10.2 12 4.2l7.5 6v9.1a.8.8 0 0 1-.8.8h-4.3v-5.7H9.6v5.7H5.3a.8.8 0 0 1-.8-.8z" />
    </>
  ),
  trending: (
    <>
      <path d="M4 17.4 9.1 12l3.7 3.4L20 8.2" />
      <path d="M15.2 8.2H20v4.8" />
    </>
  ),
  users: (
    <>
      <circle cx="9.2" cy="8.2" r="3" />
      <path d="M3.8 19.6a5.4 5.4 0 0 1 10.8 0" />
      <circle cx="17" cy="9.6" r="2.3" />
      <path d="M16.6 15.4c2.2.2 3.6 1.7 3.6 3.9" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16.2V4.4" />
      <path d="M7.6 8.8 12 4.4l4.4 4.4" />
      <path d="M4.6 14.6v4.2a1 1 0 0 0 1 1h12.8a1 1 0 0 0 1-1v-4.2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.4" r="3.4" />
      <path d="M5.4 20a6.6 6.6 0 0 1 13.2 0" />
    </>
  ),
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="5.6" />
      <path d="m15.2 15.2 4 4" />
    </>
  ),
  bell: (
    <>
      <path d="M6.6 10.4a5.4 5.4 0 0 1 10.8 0c0 3.6.9 4.9 1.6 5.6H5c.7-.7 1.6-2 1.6-5.6z" />
      <path d="M10.2 19.2a1.9 1.9 0 0 0 3.6 0" />
    </>
  ),
  heart: <path d="M12 19.5s-7.2-4.3-7.2-9A4.1 4.1 0 0 1 12 7.7a4.1 4.1 0 0 1 7.2 2.8c0 4.7-7.2 9-7.2 9z" />,
  comment: (
    <>
      <path d="M20 12.4c0 3.7-3.6 6.7-8 6.7a9.5 9.5 0 0 1-2.3-.3L5 20.2l1.2-3.3A6.3 6.3 0 0 1 4 12.4c0-3.7 3.6-6.7 8-6.7s8 3 8 6.7z" />
    </>
  ),
  share: (
    <>
      <path d="M14.6 4.8 20 10l-5.4 5.2" />
      <path d="M20 10H10.4A5.4 5.4 0 0 0 5 15.4V19" />
    </>
  ),
  more: (
    <>
      <circle cx="5.6" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="18.4" cy="12" r="1.4" />
    </>
  ),
  close: (
    <>
      <path d="m6 6 12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
  'chevron-left': <path d="m14.5 6.5-5 5.5 5 5.5" />,
  'chevron-right': <path d="m9.5 6.5 5 5.5-5 5.5" />,
  'chevron-down': <path d="m6.5 9.5 5.5 5 5.5-5" />,
  plus: (
    <>
      <path d="M12 5.5v13" />
      <path d="M5.5 12h13" />
    </>
  ),
  check: <path d="m5.5 12.5 4.2 4.2 8.8-9" />,
  alert: (
    <>
      <path d="M12 4.8 20.4 19H3.6z" />
      <path d="M12 10v4" />
      <path d="M12 16.6v.4" />
    </>
  ),
  flag: (
    <>
      <path d="M6 20V4.6" />
      <path d="M6 5.2h11.6l-1.9 3.9 1.9 3.9H6" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M4 4l16 16" />
      <path d="M9.5 5.4A9.6 9.6 0 0 1 12 5.2c4.7 0 8 4 8 6.8a8 8 0 0 1-2.2 3.8" />
      <path d="M6.4 7.3A8.4 8.4 0 0 0 4 12c0 2.8 3.3 6.8 8 6.8a9.4 9.4 0 0 0 3.4-.6" />
      <path d="M10.4 10.5a2.2 2.2 0 0 0 3 3" />
    </>
  ),
  trash: (
    <>
      <path d="M4.8 7.2h14.4" />
      <path d="M9.4 7.2V4.8h5.2v2.4" />
      <path d="M6.6 7.2 7.5 20h9l.9-12.8" />
      <path d="M10.4 11v5.2" />
      <path d="M13.6 11v5.2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="2.7" />
      <path d="M12 3.6v2M12 18.4v2M4.8 12h-2M21.2 12h-2M6.9 6.9 5.5 5.5M18.5 18.5l-1.4-1.4M17.1 6.9l1.4-1.4M5.5 18.5l1.4-1.4" />
    </>
  ),
  logout: (
    <>
      <path d="M14.6 4.8H6.2a1 1 0 0 0-1 1v12.4a1 1 0 0 0 1 1h8.4" />
      <path d="M15.6 8.4 19.2 12l-3.6 3.6" />
      <path d="M9.6 12h9.6" />
    </>
  ),
  link: (
    <>
      <path d="M10.4 13.6a3.6 3.6 0 0 0 5.1 0l2.6-2.6a3.6 3.6 0 0 0-5.1-5.1l-1.3 1.3" />
      <path d="M13.6 10.4a3.6 3.6 0 0 0-5.1 0l-2.6 2.6a3.6 3.6 0 0 0 5.1 5.1l1.3-1.3" />
    </>
  ),
  volume: (
    <>
      <path d="M11 5.6 7.2 9H4.4v6h2.8l3.8 3.4z" />
      <path d="M15 9.2a4 4 0 0 1 0 5.6" />
      <path d="M17.6 6.8a7.4 7.4 0 0 1 0 10.4" />
    </>
  ),
  mute: (
    <>
      <path d="M11 5.6 7.2 9H4.4v6h2.8l3.8 3.4z" />
      <path d="m15.2 9.8 4.4 4.4" />
      <path d="m19.6 9.8-4.4 4.4" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.8 5.4 6.4v5.4c0 4.1 2.8 6.9 6.6 8.4 3.8-1.5 6.6-4.3 6.6-8.4V6.4z" />
      <path d="m9.2 12.2 2 2 3.6-3.8" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.6V12l3 1.9" />
    </>
  ),
  'arrow-left': (
    <>
      <path d="M19 12H5.4" />
      <path d="m10.6 6.6-5 5.4 5 5.4" />
    </>
  ),
  edit: (
    <>
      <path d="M5 19h3.6l9.2-9.2-3.6-3.6L5 15.4z" />
      <path d="m13.4 5.6 3.6 3.6" />
    </>
  ),
  play: <path d="M8.6 5.4 19 12 8.6 18.6z" />,
  grid: (
    <>
      <rect x="4.2" y="4.2" width="6.4" height="6.4" rx="1" />
      <rect x="13.4" y="4.2" width="6.4" height="6.4" rx="1" />
      <rect x="4.2" y="13.4" width="6.4" height="6.4" rx="1" />
      <rect x="13.4" y="13.4" width="6.4" height="6.4" rx="1" />
    </>
  ),
  spark: (
    <>
      <path d="M12 4.4v3.2M12 16.4v3.2M4.4 12h3.2M16.4 12h3.2" />
      <path d="m7 7 2.2 2.2M14.8 14.8 17 17M17 7l-2.2 2.2M9.2 14.8 7 17" />
    </>
  ),
};

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
  filled?: boolean;
}

export function Icon({ name, size = 21, filled = false, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}

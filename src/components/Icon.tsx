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
  | 'play'
  | 'pause'
  | 'volume'
  | 'mute'
  | 'fullscreen'
  | 'close'
  | 'check'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'settings'
  | 'shield'
  | 'eye'
  | 'clock'
  | 'flag'
  | 'eye-off'
  | 'trash'
  | 'link'
  | 'plus'
  | 'camera'
  | 'image'
  | 'arrow-left'
  | 'more'
  | 'alert'
  | 'logout'
  | 'spark';

const paths: Record<IconName, ReactNode> = {
  home: <path d="M4 10.4 12 4l8 6.4V20a1 1 0 0 1-1 1h-4.6v-6H9.6v6H5a1 1 0 0 1-1-1z" />,
  trending: (
    <>
      <path d="M4 17.5 9.2 12l3.8 3.6L20 8" />
      <path d="M15 8h5v5" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" />
      <circle cx="17" cy="9.5" r="2.4" />
      <path d="M16.5 15.5c2.3.1 4 1.7 4 4" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4" />
      <path d="M7.5 8.5 12 4l4.5 4.5" />
      <path d="M4.5 15v4a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-4" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.2" />
      <path d="m15.6 15.6 4.4 4.4" />
    </>
  ),
  bell: (
    <>
      <path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 3 .8 4 1.8 5.2H4.7C5.7 14 6.5 13 6.5 10z" />
      <path d="M10 18.8a2 2 0 0 0 4 0" />
    </>
  ),
  heart: <path d="M12 20s-7.2-4.4-7.2-9A3.9 3.9 0 0 1 12 8.4 3.9 3.9 0 0 1 19.2 11c0 4.6-7.2 9-7.2 9z" />,
  comment: <path d="M4.5 5.5h15v10.8h-7.2L7 20.4v-4.1H4.5z" />,
  share: (
    <>
      <path d="M12 15.5V4" />
      <path d="M8 8l4-4 4 4" />
      <path d="M5 14v5.2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V14" />
    </>
  ),
  play: <path d="M8 5.6 19 12 8 18.4z" />,
  pause: (
    <>
      <rect x="7.5" y="5.5" width="3.2" height="13" rx="0.8" />
      <rect x="13.3" y="5.5" width="3.2" height="13" rx="0.8" />
    </>
  ),
  volume: (
    <>
      <path d="M4 9.8h3.6L13 5.6v12.8l-5.4-4.2H4z" />
      <path d="M16.2 9.2a4 4 0 0 1 0 5.6" />
      <path d="M18.5 6.8a7.3 7.3 0 0 1 0 10.4" />
    </>
  ),
  mute: (
    <>
      <path d="M4 9.8h3.6L13 5.6v12.8l-5.4-4.2H4z" />
      <path d="m16.5 9.5 4.8 5M21.3 9.5l-4.8 5" />
    </>
  ),
  fullscreen: (
    <>
      <path d="M4 9V4h5" />
      <path d="M15 4h5v5" />
      <path d="M20 15v5h-5" />
      <path d="M9 20H4v-5" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m5 12.5 4.4 4.4L19 7" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  'chevron-left': <path d="m14.5 5.5-6 6.5 6 6.5" />,
  'chevron-right': <path d="m9.5 5.5 6 6.5-6 6.5" />,
  settings: (
    <>
      <path d="M4 7h8.5M17.5 7H20M4 17h4M12 17h8" />
      <circle cx="15" cy="7" r="2.4" />
      <circle cx="9" cy="17" r="2.4" />
    </>
  ),
  shield: <path d="m12 3.5 7 2.6v5.6c0 4.1-3 7.3-7 8.8-4-1.5-7-4.7-7-8.8V6.1z" />,
  eye: (
    <>
      <path d="M2.8 12S6.2 6.2 12 6.2 21.2 12 21.2 12 18 17.8 12 17.8 2.8 12 2.8 12z" />
      <circle cx="12" cy="12" r="2.4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.6V12l3 1.9" />
    </>
  ),
  flag: (
    <>
      <path d="M6 21V4.2h11.5l-2.2 4 2.2 4H6" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M4 4.5 20 20" />
      <path d="M9.8 6.6C10.5 6.3 11.2 6.2 12 6.2c5.8 0 9.2 5.8 9.2 5.8a17 17 0 0 1-3 3.5M6.3 8.2A17.5 17.5 0 0 0 2.8 12S6.2 17.8 12 17.8c1.1 0 2.1-.2 3-.6" />
    </>
  ),
  trash: (
    <>
      <path d="M5 7h14M9.5 7V4.8h5V7M7.2 7l.9 12.3h7.8L16.8 7" />
    </>
  ),
  link: (
    <>
      <path d="M10.2 13.8a4 4 0 0 0 5.7 0l2.2-2.2a4 4 0 0 0-5.7-5.7L11 7.3" />
      <path d="M13.8 10.2a4 4 0 0 0-5.7 0l-2.2 2.2a4 4 0 0 0 5.7 5.7l1.4-1.4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  camera: (
    <>
      <path d="M4 8.5h3.3l1.4-2h6.6l1.4 2H20v10H4z" />
      <circle cx="12" cy="13.4" r="3" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="1.6" />
      <circle cx="8.6" cy="10" r="1.4" />
      <path d="M4.6 16.4l4.4-4 3.4 3 2.4-2.2 4.6 4.2" />
    </>
  ),
  'arrow-left': (
    <>
      <path d="M20 12H5" />
      <path d="m11 6-6 6 6 6" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4 21 19.5H3z" />
      <path d="M12 10v4.4M12 17.2v.2" />
    </>
  ),
  logout: (
    <>
      <path d="M14.5 4H19v16h-4.5" />
      <path d="M10.5 8 6.5 12l4 4M6.5 12H15" />
    </>
  ),
  spark: <path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9z" />,
};

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
  filled?: boolean;
}

export function Icon({ name, size = 20, filled, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
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

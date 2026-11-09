import { useState } from 'react';
import { Icon, type IconName } from './Icon.tsx';
import { Loader } from './Loader.tsx';
import { Player, type WatchStats } from './Player.tsx';
import { useAuthorizedMedia } from '../lib/media.ts';

/** A pending or removed video, fetched with the session token before playing. */
export function AuthorizedPlayer({
  src,
  active,
  onWatch,
}: {
  src: string;
  active: boolean;
  onWatch?: (stats: WatchStats) => void;
}) {
  const { src: resolved, error } = useAuthorizedMedia(src, true);

  if (error) {
    return (
      <div className="feed-stage">
        <div className="stage-error">
          <Icon name="alert" size={22} />
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!resolved) {
    return (
      <div className="feed-stage">
        <div className="stage-loading" role="status" aria-label="Loading video">
          <Loader />
        </div>
      </div>
    );
  }

  return <Player key={resolved} src={resolved} active={active} onWatch={onWatch} />;
}

/** A thumbnail for a post that is not public yet. */
export function AuthorizedImage({
  src,
  alt = '',
  className,
  fallbackIcon = 'image',
  fallbackSize = 16,
}: {
  src: string | null;
  alt?: string;
  className?: string;
  fallbackIcon?: IconName;
  fallbackSize?: number;
}) {
  const { src: resolved, error } = useAuthorizedMedia(src, true);
  const [failed, setFailed] = useState(false);

  if (!resolved || error || failed) {
    return <Icon name={fallbackIcon} size={fallbackSize} />;
  }

  return <img className={className} src={resolved} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}

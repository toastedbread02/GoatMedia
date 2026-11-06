import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import type { VideoDTO } from '../../shared/types.ts';
import { compactNumber, formatDuration, timeAgo } from '../lib/format.ts';
import { StatusTag } from './StatusTag.tsx';
import { Icon } from './Icon.tsx';
import { AuthorizedImage } from './AuthorizedMedia.tsx';

interface VideoCardProps {
  video: VideoDTO;
  showStatus?: boolean;
  showCreator?: boolean;
  index?: number;
}

export function VideoCard({ video, showStatus = false, showCreator = false, index = 0 }: VideoCardProps) {
  return (
    <article className="videocard stagger-in" style={{ '--i': index } as CSSProperties}>
      <Link to={`/v/${video.id}`} className="videocard__link">
        <div className={`videocard__thumb${video.kind === 'photos' ? ' videocard__thumb--album' : ''}`}>
          {video.posterUrl ? (
            video.status === 'approved' ? (
              <img src={video.posterUrl} alt="" loading="lazy" decoding="async" />
            ) : (
              <AuthorizedImage src={video.posterUrl} fallbackIcon="play" fallbackSize={22} />
            )
          ) : (
            <div className="videocard__fallback" aria-hidden="true">
              {video.categoryLabel.slice(0, 1)}
            </div>
          )}
          {video.kind === 'photos' ? (
            <span className="videocard__count">
              <Icon name="image" size={12} /> {video.photos.length}
            </span>
          ) : (
            <span className="videocard__duration">{formatDuration(video.duration)}</span>
          )}
        </div>
        <div className="videocard__body">
          <p className="videocard__title">{video.caption || 'Untitled goat post'}</p>
          <p className="videocard__meta">
            {compactNumber(video.viewCount)} views{' · '}
            {timeAgo(video.publishedAt ?? video.createdAt)}
          </p>
          {showCreator ? (
            <p className="videocard__creator">
              @{video.creator.username}
              {video.creator.isModerator ? (
                <span className="modbadge" title="Moderator" aria-label="Moderator">
                  <Icon name="shield" size={12} filled />
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
      </Link>
      {showStatus ? (
        <div className="videocard__status">
          <StatusTag status={video.status} />
          {video.status === 'rejected' && video.rejectReason ? (
            <p className="videocard__reason">{video.rejectReason}</p>
          ) : null}
          {video.status === 'pending' ? (
            <p className="videocard__reason">A human is watching this one.</p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

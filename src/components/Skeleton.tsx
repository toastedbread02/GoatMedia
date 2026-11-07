import type { CSSProperties, ReactNode } from 'react';

/** A single placeholder block. Decorative: the status text carries the meaning. */
export function Skeleton({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return <span className={`sk ${className}`} style={style} aria-hidden="true" />;
}

function Status({ children }: { children: ReactNode }) {
  return (
    <p className="visually-hidden" role="status">
      {children}
    </p>
  );
}

/** One full viewport of the vertical feed: media column plus the detail rail. */
export function FeedSkeleton({ label = 'Loading posts' }: { label?: string }) {
  return (
    <div className="feed-page">
      <Status>{label}</Status>
      <div className="feed-scroller" aria-hidden="true">
        <div className="feed-item feed-skel">
          <div className="feed-skel__stage">
            <Skeleton className="feed-skel__frame" />
          </div>
          <div className="feed-info feed-skel__info">
            <div className="feed-skel__creator">
              <Skeleton className="sk--avatar" />
              <span className="feed-skel__stack">
                <Skeleton className="sk--line" style={{ width: 118 }} />
                <Skeleton className="sk--line sk--sm" style={{ width: 74 }} />
              </span>
              <Skeleton className="sk--button" style={{ marginLeft: 'auto' }} />
            </div>
            <span className="feed-skel__stack">
              <Skeleton className="sk--line" style={{ width: '94%' }} />
              <Skeleton className="sk--line" style={{ width: '78%' }} />
              <Skeleton className="sk--line sk--sm" style={{ width: '44%' }} />
            </span>
            <div className="feed-skel__actions">
              {[0, 1, 2, 3].map((index) => (
                <Skeleton className="sk--tile" key={index} />
              ))}
            </div>
            <Skeleton className="sk--block" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** The video card grid used by profiles and search results. */
export function GridSkeleton({ count = 6, label = 'Loading posts' }: { count?: number; label?: string }) {
  return (
    <div className="video-grid" aria-hidden="true">
      <Status>{label}</Status>
      {Array.from({ length: count }, (_, index) => (
        <div className="videocard card-skel" key={index}>
          <Skeleton className="card-skel__thumb" />
          <Skeleton className="sk--line" style={{ width: '88%', marginTop: 10 }} />
          <Skeleton className="sk--line sk--sm" style={{ width: '48%', marginTop: 6 }} />
        </div>
      ))}
    </div>
  );
}

/** Profile header (photo, name, bio, counts) before the account arrives. */
export function ProfileSkeleton() {
  return (
    <div className="page profile-page">
      <Status>Loading profile</Status>
      <div className="profile-skel" aria-hidden="true">
        <Skeleton className="profile-skel__avatar" />
        <div className="profile-skel__body">
          <Skeleton className="sk--line" style={{ width: 190, height: 22 }} />
          <Skeleton className="sk--line sk--sm" style={{ width: 120 }} />
          <Skeleton className="sk--line" style={{ width: '62%' }} />
          <div className="profile-skel__stats">
            {[0, 1, 2].map((index) => (
              <Skeleton className="sk--line" key={index} style={{ width: 74 }} />
            ))}
          </div>
          <Skeleton className="sk--button" style={{ width: 116 }} />
        </div>
      </div>
      <GridSkeleton count={6} label="Loading posts" />
    </div>
  );
}

/** A single post page: player, caption and the side column. */
export function PostSkeleton() {
  return (
    <div className="page page--video">
      <Status>Loading post</Status>
      <div className="video-layout" aria-hidden="true">
        <div className="video-column">
          <div className="feed-stage video-skel-stage">
            <Skeleton className="feed-skel__frame" />
          </div>
          <Skeleton className="sk--line" style={{ width: '58%', height: 22, marginTop: 20 }} />
          <Skeleton className="sk--line sk--sm" style={{ width: '30%', marginTop: 10 }} />
          <Skeleton className="sk--block" style={{ marginTop: 18 }} />
        </div>
        <div className="video-skel-side">
          <Skeleton className="sk--avatar" />
          <Skeleton className="sk--line" style={{ width: '70%' }} />
          <Skeleton className="sk--line sk--sm" style={{ width: '40%' }} />
          <Skeleton className="sk--block" />
          <Skeleton className="sk--block" />
        </div>
      </div>
    </div>
  );
}

/** Settings: a label column beside stacked controls, matching the real layout. */
export function SettingsSkeleton() {
  return (
    <div className="page settings-page">
      <Status>Loading settings</Status>
      <div className="page-head">
        <div>
          <Skeleton className="sk--line" style={{ width: 160, height: 28 }} />
          <Skeleton className="sk--line sk--sm" style={{ width: 300, marginTop: 10 }} />
        </div>
      </div>
      <div aria-hidden="true">
        {[0, 1, 2, 3].map((index) => (
          <div className="settings-section" key={index}>
            <div className="settings-section__intro">
              <Skeleton className="sk--line" style={{ width: 96, height: 18 }} />
              <Skeleton className="sk--line sk--sm" style={{ width: '90%', marginTop: 8 }} />
            </div>
            <div className="settings-section__body">
              {index === 0 ? (
                <div className="feed-skel__creator">
                  <Skeleton className="sk--avatar sk--avatar-lg" />
                  <Skeleton className="sk--button" style={{ width: 124 }} />
                </div>
              ) : null}
              <Skeleton className="sk--line" style={{ width: '70%' }} />
              <Skeleton className="sk--field" />
              <Skeleton className="sk--field" />
              <Skeleton className="sk--button" style={{ width: 110 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The moderation page: queue on the left, player and actions on the right. */
export function AdminSkeleton() {
  return (
    <div className="page admin-page">
      <Status>Loading moderation</Status>
      <div className="page-head">
        <div>
          <Skeleton className="sk--line" style={{ width: 170, height: 28 }} />
          <Skeleton className="sk--line sk--sm" style={{ width: 280, marginTop: 10 }} />
        </div>
      </div>
      <div className="admin-layout" aria-hidden="true">
        <div className="admin-list">
          <RowSkeleton count={5} label="Loading queue" />
        </div>
        <div className="video-skel-side">
          <Skeleton className="sk--line" style={{ width: 120, height: 20 }} />
          <Skeleton className="video-skel-stage" />
          <Skeleton className="sk--block" />
          <Skeleton className="sk--button" style={{ width: 140 }} />
        </div>
      </div>
    </div>
  );
}

/** Rows for the moderation queue, report list and account list. */
export function RowSkeleton({ count = 5, label = 'Loading' }: { count?: number; label?: string }) {
  return (
    <div className="row-skel" aria-hidden="true">
      <Status>{label}</Status>
      {Array.from({ length: count }, (_, index) => (
        <div className="row-skel__row" key={index}>
          <Skeleton className="row-skel__thumb" />
          <span className="row-skel__body">
            <Skeleton className="sk--line" style={{ width: '62%' }} />
            <Skeleton className="sk--line sk--sm" style={{ width: '38%' }} />
          </span>
        </div>
      ))}
    </div>
  );
}

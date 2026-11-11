import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '../components/Avatar.tsx';
import { VideoCard } from '../components/VideoCard.tsx';
import { ArgTraceMark } from '../components/ArgTrace.tsx';
import { useDocumentTitle } from '../lib/hooks.ts';
import { monthYear } from '../lib/format.ts';
import { argPost, argProfile } from '../lib/easterEgg.ts';
import { playProfileGlitch } from '../lib/argSound.ts';

/**
 * A profile for one of the accounts in the thread. It uses the same header and
 * grid as every other profile, including the empty state, so the only strange
 * thing about it is the numbers.
 */
export function ArgProfilePage({ username }: { username: string }) {
  const entry = argProfile(username);
  useDocumentTitle(
    entry ? `${entry.user.displayName} (@${entry.user.username})` : 'Profile',
  );

  // The click that opens this page is the gesture the sound needs, so both
  // start together: the page tears for a moment and the tone goes with it.
  const tears = username === 'marlowe_farm';
  const [glitching, setGlitching] = useState(false);

  useEffect(() => {
    if (!tears) return;
    setGlitching(true);
    playProfileGlitch();
    const timer = window.setTimeout(() => setGlitching(false), 900);
    return () => window.clearTimeout(timer);
  }, [tears]);

  if (!entry) return null;
  const { user } = entry;

  const posts = entry.postIds
    .map((id) => argPost(id)?.video)
    .filter((video): video is NonNullable<typeof video> => Boolean(video));

  return (
    <div className={`page arg-profile${glitching ? ' is-glitching' : ''}`}>
      <header className="profile-head">
        <Avatar
          displayName={user.displayName}
          username={user.username}
          avatarUrl={user.avatarUrl}
          size={92}
          className="profile-avatar"
        />
        <div className="profile-head__body">
          <h1 className="profile-name">{user.displayName}</h1>
          <p className="profile-username">@{user.username}</p>
          <p className="profile-bio">{user.bio || 'No bio yet.'}</p>
          <p className="profile-counts">
            <span>
              <strong>{user.followerCount}</strong> {user.followerCount === 1 ? 'follower' : 'followers'}
            </span>
            <span className="meta-sep" aria-hidden="true">
              ·
            </span>
            <span>
              <strong>{user.followingCount}</strong> following
            </span>
            <span className="meta-sep" aria-hidden="true">
              ·
            </span>
            <span>
              <strong>{user.videoCount}</strong> {user.videoCount === 1 ? 'post' : 'posts'}
            </span>
          </p>
          <p className="profile-joined">Joined {monthYear(user.createdAt)}</p>
        </div>
      </header>

      <ArgTraceMark trace={entry.trace} />

      <div className="profile-tabs" role="tablist" aria-label="Videos">
        <button type="button" role="tab" aria-selected className="profile-tab is-active">
          Published
        </button>
      </div>

      {posts.length ? (
        <div className="video-grid">
          {posts.map((video, index) => (
            <VideoCard key={video.id} video={video} index={index} />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <h2>Nothing published yet. The first approved post will show up here.</h2>
          <p>This creator has not had a post approved yet.</p>
          <Link className="btn btn--quiet btn--sm" to="/">
            Back to the feed
          </Link>
        </div>
      )}
    </div>
  );
}

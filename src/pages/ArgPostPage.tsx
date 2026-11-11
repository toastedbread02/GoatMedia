import { Link } from 'react-router-dom';
import { FeedItem } from '../components/FeedItem.tsx';
import { useDocumentTitle } from '../lib/hooks.ts';
import { argGhost, argPost } from '../lib/easterEgg.ts';

/**
 * A single post on the trail. It is laid out exactly like a post in the feed,
 * because it is meant to look like one: the only way here is a path, and the
 * page offers nothing that says it is any different.
 */
export function ArgPostPage({ id }: { id: string }) {
  const entry = argPost(id);
  useDocumentTitle(entry ? entry.video.caption.slice(0, 48) : 'Post');

  if (!entry) return null;
  const ghost = argGhost(entry.video.id);

  return (
    <div className="feed-page">
      {/* The item carries the trace itself, so the page does not add a second. */}
      <div className="feed-scroller">
        <FeedItem video={entry.video} index={0} activeIndex={0} onNotInterested={() => {}} />
      </div>
      {ghost ? (
        <Link className="arg-ghost" to={ghost} tabIndex={-1} aria-hidden="true">
          .
        </Link>
      ) : null}
    </div>
  );
}

import { FeedItem } from '../components/FeedItem.tsx';
import { useDocumentTitle } from '../lib/hooks.ts';
import type { ArgEntry } from '../lib/easterEgg.ts';

/**
 * A single post on the trail. It is laid out exactly like a post in the feed,
 * because it is meant to look like one: the only way here is a path, and the
 * page offers nothing that says it is any different.
 *
 * The route only hands over an entry it was willing to answer for, so a keyed
 * page arrives here already unlocked or not here at all.
 */
export function ArgPostPage({ entry }: { entry: ArgEntry }) {
  useDocumentTitle(entry.video.caption.slice(0, 48));

  return (
    <div className="feed-page">
      <div className="feed-scroller">
        <FeedItem video={entry.video} index={0} activeIndex={0} onNotInterested={() => {}} />
      </div>
    </div>
  );
}

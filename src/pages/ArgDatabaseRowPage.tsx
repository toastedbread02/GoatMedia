import { useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { NotFoundPage } from './AuthPages.tsx';
import { ArgTraceMark } from '../components/ArgTrace.tsx';
import { useDocumentTitle } from '../lib/hooks.ts';
import { hash, num, pad } from '../lib/argDumpFormat.ts';

const DAY = 86_400_000;
const KEY = '0640';
/** The number the dump uses for the post that has no page. */
const ROW = '16';
const VIDEO_ID = `pst_1298d000000000${ROW}`;
const PATH = `/v/${VIDEO_ID}`;
/** How often the log writes this page again while it sits open. */
const VISIT_GAP = 9000;
/** How far before the reader the first visit is dated. */
const LEAD = 47 * 60_000;

/**
 * One row of the videos table, followed wherever it goes. The dump lists the
 * deleted post; this is what the tables hold for it — a file of zero bytes, a
 * recovery that claims 263480 bytes of it and is still pending, a note telling
 * somebody to keep the row, and visits to a page that has never answered.
 *
 * The count is the uneasy part: it keeps rising while the page is open, a new
 * visit every nine seconds, all of them from this browser.
 *
 * Only the row that has no page resolves. Every other id is just a path.
 */
export function ArgDatabaseRowPage() {
  const { id } = useParams();
  const { search } = useLocation();
  const unlocked = new URLSearchParams(search).get('t') === KEY;
  const known = id === ROW;
  useDocumentTitle(unlocked && known ? 'd1 · row' : 'Not found');

  // Nothing here is stored or sent. The page simply writes itself into its own
  // log for as long as somebody is looking at it.
  const [ticks, setTicks] = useState(0);
  useEffect(() => {
    if (!unlocked || !known) return;
    const timer = window.setInterval(() => setTicks((count) => count + 1), VISIT_GAP);
    return () => window.clearInterval(timer);
  }, [unlocked, known]);

  if (!unlocked || !known) return <NotFoundPage />;

  const now = Date.now();
  const stamp = (daysAgo: number) =>
    new Date(now - daysAgo * DAY).toISOString().replace('T', ' ').slice(0, 19);
  const fmt = (timestamp: number) => new Date(timestamp).toISOString().replace('T', ' ').slice(0, 19);
  const ua = hash(navigator.userAgent);

  const seen: Array<{ id: number; at: number }> = [
    { id: 2, at: now - LEAD },
    ...Array.from({ length: ticks }, (_, index) => ({
      id: 3 + index,
      at: now - (ticks - 1 - index) * VISIT_GAP,
    })),
  ];

  const body = [
    `sqlite> select * from videos where id = '${VIDEO_ID}';`,
    `${pad('id', 24)}${pad('kind', 8)}${pad('status', 10)}${num('views', 7)}${num('likes', 7)}${num(
      'comments',
      10,
    )}  ${pad('created_at', 21)}deleted_at`,
    `${pad(VIDEO_ID, 24)}${pad('video', 8)}${pad('deleted', 10)}${num(0, 7)}${num(0, 7)}${num(
      1,
      10,
    )}  ${pad(stamp(1294), 21)}${stamp(1294)}`,
    '',
    "sqlite> select path, bytes, mime, uploaded_at from files where path like '000000000016%';",
    `${pad('path', 24)}${num('bytes', 9)}  ${pad('mime', 11)}uploaded_at`,
    `${pad('000000000016.mp4', 24)}${num(0, 9)}  ${pad('video/mp4', 11)}${stamp(1293)}`,
    `${pad('000000000016.rec.mp4', 24)}${num(263480, 9)}  ${pad('video/mp4', 11)}${stamp(1293)}`,
    '',
    `sqlite> select * from recovery where video_id = '${VIDEO_ID}';`,
    `${pad('id', 4)}${pad('video_id', 24)}${pad('file', 24)}${num('bytes', 9)}  ${pad(
      'restored_at',
      21,
    )}status`,
    `${pad('1', 4)}${pad(VIDEO_ID, 24)}${pad('000000000016.rec.mp4', 24)}${num(263480, 9)}  ${pad(
      stamp(1293),
      21,
    )}pending`,
    '',
    `sqlite> select * from notes where video_id = '${VIDEO_ID}';`,
    `${pad('id', 4)}${pad('video_id', 24)}body`,
    `${pad('9', 4)}${pad(VIDEO_ID, 24)}never uploaded. keep the row.`,
    '',
    `sqlite> select count(*) from visits where path = '${PATH}';`,
    `${pad('count(*)', 4)}`,
    `${pad(seen.length, 4)}`,
    '',
    `sqlite> select * from visits where path = '${PATH}';`,
    `${pad('id', 4)}${pad('path', 34)}${pad('seen_at', 22)}ua`,
    ...seen.map(
      (visit) => `${pad(visit.id, 4)}${pad(PATH, 34)}${pad(fmt(visit.at), 22)}${ua}`,
    ),
    '',
    'sqlite> .quit',
  ].join('\n');

  return (
    <div className="page arg-db-page">
      <ArgTraceMark trace={{ label: `d1/${ROW}`, note: 'zero bytes; the log keeps going' }} />
      <pre className="arg-db">{body}</pre>
    </div>
  );
}

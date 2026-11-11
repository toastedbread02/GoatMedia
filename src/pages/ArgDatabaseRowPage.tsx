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

/**
 * One row of the videos table, followed wherever it goes. The dump lists the
 * deleted post; this is what the table holds for it — a file of zero bytes dated
 * the day after the post, a note telling somebody to keep the row, and one visit
 * to a page that has never answered.
 *
 * Only the row that has no page resolves. Every other id is just a path.
 */
export function ArgDatabaseRowPage() {
  const { id } = useParams();
  const { search } = useLocation();
  const unlocked = new URLSearchParams(search).get('t') === KEY;
  const known = id === ROW;
  useDocumentTitle(unlocked && known ? 'd1 · row' : 'Not found');

  if (!unlocked || !known) return <NotFoundPage />;

  const now = Date.now();
  const stamp = (daysAgo: number) =>
    new Date(now - daysAgo * DAY).toISOString().replace('T', ' ').slice(0, 19);
  const fmt = (timestamp: number) => new Date(timestamp).toISOString().replace('T', ' ').slice(0, 19);
  const ua = hash(navigator.userAgent);

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
    '',
    `sqlite> select * from notes where video_id = '${VIDEO_ID}';`,
    `${pad('id', 4)}${pad('video_id', 24)}body`,
    `${pad('9', 4)}${pad(VIDEO_ID, 24)}never uploaded. keep the row.`,
    '',
    "sqlite> select * from visits where path = '/v/pst_1298d00000000016';",
    `${pad('id', 4)}${pad('path', 34)}${pad('seen_at', 22)}ua`,
    `${pad('2', 4)}${pad(`/v/${VIDEO_ID}`, 34)}${pad(fmt(now - 47 * 60_000), 22)}${ua}`,
    '',
    'sqlite> .quit',
  ].join('\n');

  return (
    <div className="page arg-db-page">
      <ArgTraceMark trace={{ label: `d1/${ROW}`, note: 'zero bytes, one visit' }} />
      <pre className="arg-db">{body}</pre>
    </div>
  );
}

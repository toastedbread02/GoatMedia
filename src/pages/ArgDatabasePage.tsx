import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { NotFoundPage } from './AuthPages.tsx';
import { ArgTraceMark } from '../components/ArgTrace.tsx';
import { useDocumentTitle } from '../lib/hooks.ts';

const DAY = 86_400_000;
const KEY = '0640';

function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const pad = (value: string | number, width: number) => String(value).padEnd(width);
const num = (value: string | number, width: number) => String(value).padStart(width);

/**
 * Not a post. The tables behind the trail, laid out the way a database client
 * prints them. Everything here can be checked against the pages, and a few rows
 * cannot be made to agree with them.
 */
export function ArgDatabasePage() {
  const { search, pathname } = useLocation();
  const unlocked = new URLSearchParams(search).get('t') === KEY;
  useDocumentTitle(unlocked ? 'd1 · goatmedia' : 'Not found');

  const dump = useMemo(() => {
    const now = Date.now();
    const stamp = (daysAgo: number) =>
      new Date(now - daysAgo * DAY).toISOString().replace('T', ' ').slice(0, 19);

    const videos: Array<[string, string, string, number, number, number, number, string]> = [
      ['pst_1298d00000000014', 'video', 'approved', 41, 0, 3, 1300, ''],
      ['pst_1298d00000000008', 'video', 'approved', 8407, 96, 96, 1299, ''],
      ['pst_1298d00000000009', 'video', 'approved', 1983752, 232, 232, 1298, ''],
      ['pst_1298d00000000010', 'video', 'pending', 2, 0, 3, 1297, ''],
      ['pst_1298d00000000012', 'photos', 'approved', 6, 3, 4, 1296, ''],
      ['pst_1298d00000000015', 'video', 'approved', 12, 1, 4, 1295, 'do not approve'],
      ['pst_1298d00000000011', 'video', 'approved', 312, 23, 23, 3, ''],
      ['pst_1298d00000000007', 'video', 'removed', 0, 0, 0, 1300, 'removed at uploader request; file kept'],
      ['pst_1298d00000000016', 'video', 'deleted', 0, 0, 0, 1294, 'caption null; no page'],
    ];

    const videoLines = videos.map(
      ([id, kind, status, views, likes, comments, age, note]) =>
        `${pad(id, 24)}${pad(kind, 8)}${pad(status, 10)}${num(views, 9)}${num(likes, 7)}${num(
          comments,
          10,
        )}  ${stamp(age)}  ${note}`,
    );

    const accounts = [
      ['marlowe_farm', 'Marlowe', '2019-03-04 09:12:00', stamp(1301)],
      ['june_b', 'June', '2023-08-19 18:40:51', 'NULL'],
      ['priya.builds', 'Priya', '2021-11-02 07:03:16', 'NULL'],
    ].map(
      ([handle, name, created, deleted]) =>
        `${pad(handle, 16)}${pad(name, 10)}${pad(created, 22)}${pad(deleted, 22)}`,
    );

    const notes = [
      ['1', 'pst_1298d00000000009', 'keep an eye on this one'],
      ['2', 'pst_1298d00000000007', 'file kept. do not relink.'],
      ['3', 'pst_1298d00000000015', 'do not approve'],
      ['4', 'pst_1298d00000000010', '9'],
    ].map(([id, videoId, body]) => `${pad(id, 4)}${pad(videoId, 24)}${body}`);

    const migrations = [
      ['0001_init', '2022-05-14 11:02:00'],
      ['0002_accounts', '2022-05-14 11:02:01'],
      ['0003_videos', '2022-06-02 21:33:12'],
      ['0004_comments', '2022-06-02 21:33:12'],
      ['0008_visits', '2023-01-19 08:00:00'],
      ['0009_gate', stamp(1298)],
      ['0010_the_card', 'pending'],
    ].map(([name, applied]) => `${pad(name, 20)}${applied}`);

    const visits = [
      `${pad('1', 6)}${pad(`${pathname}${search}`, 40)}${pad(stamp(0), 22)}${hash(navigator.userAgent)}`,
    ];

    return [
      'sqlite> .tables',
      'accounts  notes  schema_migrations  videos  visits',
      '',
      'sqlite> select id, kind, status, views, likes, comments, created_at, note from videos order by created_at;',
      `${pad('id', 24)}${pad('kind', 8)}${pad('status', 10)}${num('views', 9)}${num('likes', 7)}${num(
        'comments',
        10,
      )}  ${pad('created_at', 21)}note`,
      ...videoLines,
      '',
      'sqlite> select handle, display_name, created_at, deleted_at from accounts;',
      `${pad('handle', 16)}${pad('display_name', 10)}${pad('created_at', 22)}deleted_at`,
      ...accounts,
      '',
      'sqlite> select * from notes;',
      ...notes,
      '',
      'sqlite> select name, applied_at from schema_migrations;',
      ...migrations,
      '',
      'sqlite> select * from visits order by seen_at desc limit 1;',
      `${pad('id', 6)}${pad('path', 40)}${pad('seen_at', 22)}ua`,
      ...visits,
    ].join('\n');
  }, [pathname, search]);

  if (!unlocked) return <NotFoundPage />;

  return (
    <div className="page arg-db-page">
      <ArgTraceMark trace={{ label: 'd1', note: 'the account was deleted before it posted' }} />
      <pre className="arg-db">{dump}</pre>
    </div>
  );
}

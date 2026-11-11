import { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { NotFoundPage } from './AuthPages.tsx';
import { ArgTraceMark } from '../components/ArgTrace.tsx';
import { useDocumentTitle } from '../lib/hooks.ts';
import { readTrail, type TrailEntry } from '../lib/argTrail.ts';

const DAY = 86_400_000;
const KEY = '0640';
/** The table prints the newest few; the rest are still stored. */
const VISITS_SHOWN = 5;

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
 *
 * The visits table is the only part that is real: it reads back the paths this
 * browser has actually been on, including every earlier opening of this page,
 * so the dump shows the reader their own trail and adds a row when they return.
 */
export function ArgDatabasePage() {
  const { search, pathname } = useLocation();
  const unlocked = new URLSearchParams(search).get('t') === KEY;
  useDocumentTitle(unlocked ? 'd1 · goatmedia' : 'Not found');

  // Read once per opening. The current page is prepended when the trail has not
  // caught up yet, which is what makes a return visit add its own row.
  const [visits] = useState<TrailEntry[]>(() => {
    const trail = readTrail();
    const current = `${pathname}${search}`;
    const latest = trail[0];
    if (latest && latest.path === current) return trail;
    return [{ path: current, at: Date.now() }, ...trail].slice(0, 12);
  });

  const dump = useMemo(() => {
    const now = Date.now();
    const stamp = (daysAgo: number) =>
      new Date(now - daysAgo * DAY).toISOString().replace('T', ' ').slice(0, 19);
    const fmt = (timestamp: number) => new Date(timestamp).toISOString().replace('T', ' ').slice(0, 19);

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
      ['5', 'visits', `visit ${visits.length}`],
      ['6', 'visits', `first path ${visits[visits.length - 1]?.path ?? 'NULL'}`],
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

    // Newest first, ids counting down from the total, the way an autoincrement
    // column reads after a descending select.
    const ua = hash(navigator.userAgent);
    const visitLines = visits.slice(0, VISITS_SHOWN).map((visit, index) => {
      const id = Math.max(1, visits.length - index);
      return `${pad(id, 6)}${pad(visit.path, 40)}${pad(fmt(visit.at), 22)}${ua}`;
    });

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
      'sqlite> select * from visits order by seen_at desc limit 5;',
      `${pad('id', 6)}${pad('path', 40)}${pad('seen_at', 22)}ua`,
      ...visitLines,
    ].join('\n');
  }, [visits]);

  if (!unlocked) return <NotFoundPage />;

  return (
    <div className="page arg-db-page">
      <ArgTraceMark trace={{ label: 'd1', note: 'the account was deleted before it posted' }} />
      <pre className="arg-db">{dump}</pre>
    </div>
  );
}

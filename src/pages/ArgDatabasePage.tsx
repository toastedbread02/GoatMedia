import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { NotFoundPage } from './AuthPages.tsx';
import { ArgTraceMark } from '../components/ArgTrace.tsx';
import { useDocumentTitle } from '../lib/hooks.ts';
import { readTrail, type TrailEntry } from '../lib/argTrail.ts';
import { hash, num, pad } from '../lib/argDumpFormat.ts';

const DAY = 86_400_000;
const KEY = '0640';
/** The table prints the newest few; the rest are still stored. */
const VISITS_SHOWN = 5;
/** How often the session row moves on while the dump is open. */
const SESSION_BEAT = 8000;

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

  // The session is not a snapshot. Every few seconds the row moves on by itself:
  // last_seen_at catches up with the clock and the request count with it, which
  // is what a session table does while somebody is still reading.
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    if (!unlocked) return;
    const timer = window.setInterval(() => setBeat((count) => count + 1), SESSION_BEAT);
    return () => window.clearInterval(timer);
  }, [unlocked]);

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
      ['7', 'files', '000000000007.mp4 kept after removal'],
      ['8', 'files', '000000000016.mp4 is 0 bytes'],
      ['9', 'pst_1298d00000000016', 'never uploaded. keep the row.'],
    ].map(([id, videoId, body]) => `${pad(id, 4)}${pad(videoId, 24)}${body}`);

    const migrations = [
      ['0001_init', '2022-05-14 11:02:00'],
      ['0002_accounts', '2022-05-14 11:02:01'],
      ['0003_videos', '2022-06-02 21:33:12'],
      ['0004_comments', '2022-06-02 21:33:12'],
      ['0008_visits', '2023-01-19 08:00:00'],
      ['0009_gate', stamp(1298)],
      ['0010_the_card', 'pending'],
      ['0011_files', stamp(1297)],
      ['0012_day12', 'pending'],
    ].map(([name, applied]) => `${pad(name, 20)}${applied}`);

    // The sizes are the ones on disk, so they can be checked against the files
    // that are served. The first two rows are not served at all, and one of
    // them is empty.
    const files: Array<[string, number, string, string]> = [
      ['000000000007.mp4', 1048576, 'video/mp4', 'kept after removal'],
      ['000000000016.mp4', 0, 'video/mp4', 'never uploaded'],
      ['000000000016.rec.mp4', 263480, 'video/mp4', 'recovered; not served'],
      ['arg/1000017640.jpg', 675592, 'image/jpeg', ''],
      ['arg/1000017641.mp4', 4015112, 'video/mp4', ''],
      ['arg/1000017642.jpg', 295928, 'image/jpeg', ''],
      ['arg/1000017643.jpg', 329429, 'image/jpeg', ''],
      ['arg/1000017644.jpg', 408123, 'image/jpeg', ''],
      ['arg/1000017645.jpg', 108796, 'image/jpeg', ''],
      ['arg/export_09.mp4', 263480, 'video/mp4', ''],
      ['arg/export_09_poster.jpg', 19542, 'image/jpeg', ''],
    ];
    const fileLines = files.map(
      ([path, bytes, mime, note]) => `${pad(path, 24)}${num(bytes, 9)}  ${pad(mime, 11)}${note}`,
    );

    // A caption written before the day it belongs to exists.
    const draftLines = [
      ['pst_1298d00000000017', 'day 12. it is not shut.', 'draft', stamp(-1)],
    ].map(
      ([id, caption, status, created]) =>
        `${pad(id, 24)}${pad(caption, 40)}${pad(status, 8)}${created}`,
    );

    // A recovery that was started on the empty file and never finished. The
    // bytes it claims are the bytes of a post that is still on the site.
    const recoveryLines = (
      [
        ['1', 'pst_1298d00000000016', '000000000016.rec.mp4', 263480, stamp(1293), 'pending'],
      ] as Array<[string, string, string, number, string, string]>
    ).map(
      ([id, videoId, file, bytes, restored, status]) =>
        `${pad(id, 4)}${pad(videoId, 24)}${pad(file, 24)}${num(bytes, 9)}  ${pad(
          restored,
          21,
        )}${status}`,
    );

    // Newest first, ids counting down from the total, the way an autoincrement
    // column reads after a descending select.
    const ua = hash(navigator.userAgent);

    // The session the visits belong to. Signed out, and still counting.
    const sessionLines = [
      [
        '4',
        fmt(visits[visits.length - 1]?.at ?? now),
        fmt(now),
        String(visits.length + beat),
        ua,
        'NULL',
      ],
    ].map(
      ([id, started, seen, paths, agent, auth]) =>
        `${pad(id, 4)}${pad(started, 22)}${pad(seen, 22)}${num(paths, 6)}  ${pad(
          agent,
          10,
        )}${auth}`,
    );

    const rows: Array<{ path: string; at: number }> = visits.slice(0, VISITS_SHOWN);

    // Every other return, the log carries one more row than the reader has made:
    // a visit to the row that has no page, placed just before their earliest.
    // It is never written to storage, so it belongs to the table, not to them.
    const openings = visits.filter((visit) => visit.path.startsWith('/admin/d1')).length;
    let stranger = false;
    if (openings >= 2 && openings % 2 === 0) {
      const oldest = visits[visits.length - 1]?.at ?? now;
      rows.push({ path: '/v/pst_1298d00000000016', at: oldest - 47 * 60_000 });
      stranger = true;
    }

    const total = visits.length + (stranger ? 1 : 0);
    const visitLines = rows.map((visit, index) => {
      const id = Math.max(1, total - index);
      return `${pad(id, 6)}${pad(visit.path, 40)}${pad(fmt(visit.at), 22)}${ua}`;
    });

    return [
      'sqlite> .tables',
      'accounts  drafts  files  notes  recovery  schema_migrations  sessions  videos  visits',
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
      'sqlite> select path, bytes, mime, note from files order by path;',
      `${pad('path', 24)}${num('bytes', 9)}  ${pad('mime', 11)}note`,
      ...fileLines,
      '',
      'sqlite> select id, caption, status, created_at from drafts;',
      `${pad('id', 24)}${pad('caption', 40)}${pad('status', 8)}created_at`,
      ...draftLines,
      '',
      "sqlite> select * from recovery where video_id = 'pst_1298d00000000016';",
      `${pad('id', 4)}${pad('video_id', 24)}${pad('file', 24)}${num('bytes', 9)}  ${pad(
        'restored_at',
        21,
      )}status`,
      ...recoveryLines,
      '',
      'sqlite> select * from sessions;',
      `${pad('id', 4)}${pad('started_at', 22)}${pad('last_seen_at', 22)}${num(
        'paths',
        6,
      )}  ${pad('ua', 10)}auth`,
      ...sessionLines,
      '',
      'sqlite> select * from visits order by seen_at desc limit 5;',
      `${pad('id', 6)}${pad('path', 40)}${pad('seen_at', 22)}ua`,
      ...visitLines,
    ].join('\n');
  }, [visits, beat]);

  if (!unlocked) return <NotFoundPage />;

  return (
    <div className="page arg-db-page">
      <ArgTraceMark trace={{ label: 'd1', note: 'the account was deleted before it posted' }} />
      {/* The row that has no page still has a row view, if you ask for the right one. */}
      <Link className="arg-ghost" to="/admin/d1/16?t=0640" tabIndex={-1} aria-hidden="true">
        .
      </Link>
      <pre className="arg-db">{dump}</pre>
    </div>
  );
}

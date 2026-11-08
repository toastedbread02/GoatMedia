import { useEffect, useState } from 'react';
import type { PurgeResult, StorageDTO, StorageRow } from '../../shared/types.ts';
import { api } from '../lib/api.ts';
import { plural } from '../lib/format.ts';
import { useToast } from '../lib/toast.tsx';
import { Icon } from './Icon.tsx';
import { Skeleton } from './Skeleton.tsx';

const LABELS: Record<StorageRow['kind'], { label: string; unit: string; plural: string }> = {
  videos: { label: 'Videos', unit: 'clip', plural: 'clips' },
  photos: { label: 'Photos', unit: 'photo', plural: 'photos' },
  sounds: { label: 'Sounds', unit: 'sound', plural: 'sounds' },
  avatars: { label: 'Profile pictures', unit: 'picture', plural: 'pictures' },
  posters: { label: 'Preview frames', unit: 'frame', plural: 'frames' },
  frames: { label: 'Safety stills', unit: 'still', plural: 'stills' },
};

/** Megabyte figures without a trailing `.0`, which reads better as a limit. */
function size(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1).replace(/\.0$/, '')} MB`;
}

/**
 * Fills the free plan's 500 MB database. Video bytes are the whole story here,
 * so the panel leads with how much room is left rather than how much was used.
 */
export function StoragePanel() {
  const [data, setData] = useState<StorageDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [purging, setPurging] = useState(false);
  const { notify } = useToast();

  useEffect(() => {
    let cancelled = false;
    api
      .get<StorageDTO>('/api/admin/storage')
      .then((next) => {
        if (cancelled) return;
        setData(next);
        setError(null);
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'Storage could not load.');
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const deleteRejected = async () => {
    setPurging(true);
    try {
      const result = await api.post<PurgeResult>('/api/admin/storage/purge');
      notify(
        result.posts > 0
          ? `Deleted ${result.posts} ${plural(result.posts, 'post')} and freed ${size(result.freedBytes)}.`
          : 'Nothing was waiting to be deleted.',
      );
      setConfirming(false);
      setReloadKey((key) => key + 1);
    } catch (purgeError) {
      notify(purgeError instanceof Error ? purgeError.message : 'Those posts could not be deleted.', {
        tone: 'error',
      });
    } finally {
      setPurging(false);
    }
  };

  const headroom = data ? Math.max(0, data.limitBytes - data.usedBytes) : 0;
  const clipsLeft =
    data && data.averageVideoBytes > 0 ? Math.floor(headroom / data.averageVideoBytes) : null;
  const tight = data ? data.percent >= data.warnAt * 100 : false;

  return (
    <section className="storage" aria-labelledby="storage-heading">
      <div className="storage__head">
        <div>
          <h2 id="storage-heading">Storage</h2>
          <p>
            {data
              ? `Video chunks are spread across ${data.databaseList.length - 1} free databases of 500 MB each.`
              : 'Video chunks are spread across the free databases.'}
          </p>
        </div>
        {data ? (
          <p className="storage__figure">
            <span>{size(data.usedBytes)}</span> of {size(data.limitBytes)}
          </p>
        ) : null}
      </div>

      {error ? (
        <div className="notice notice--error">
          <Icon name="alert" size={18} />
          <p>{error}</p>
        </div>
      ) : !data ? (
        <div className="storage__loading">
          <Skeleton className="storage__skeleton" />
        </div>
      ) : (
        <>
          <div
            className={`storage__meter${tight ? ' is-tight' : ''}`}
            role="img"
            aria-label={`${data.percent}% of the ${size(data.limitBytes)} database limit is in use`}
          >
            <span style={{ width: `${Math.max(1.5, Math.min(100, data.percent))}%` }} />
          </div>

          <p className="storage__note">
            {clipsLeft !== null && clipsLeft > 0
              ? `Room for roughly ${clipsLeft} more ${plural(clipsLeft, 'clip')} at your average size of ${size(data.averageVideoBytes)}. `
              : clipsLeft === 0
                ? 'No room for another clip at your average size. '
                : ''}
            {tight
              ? 'Uploads start failing once this is full, and storage does not reset overnight the way the daily limits do.'
              : 'Uploads keep working until it is full.'}
          </p>

          <div className="storage__databases-head">
            <h3>Databases</h3>
            <p>
              {data.inUse} of {data.databaseList.length} in use, {size(data.leftBytes)} left in
              total
            </p>
          </div>

          <ul className="storage__databases">
            {data.databaseList.map((database) => {
              const share = Math.min(100, Math.round((database.usedBytes / database.limitBytes) * 100));
              return (
                <li key={database.id} className={database.active ? 'is-active' : undefined}>
                  <span className="storage__db-name">
                    {database.label}
                    {database.active ? <span className="storage__db-flag">next clip</span> : null}
                  </span>
                  <span className="storage__db-meter" aria-hidden="true">
                    <span style={{ width: `${Math.max(share, database.usedBytes > 0 ? 2 : 0)}%` }} />
                  </span>
                  <span className="storage__db-size">
                    {database.usedBytes > 0 ? size(database.usedBytes) : 'empty'}
                    <span className="storage__db-of"> of {size(database.limitBytes)}</span>
                  </span>
                </li>
              );
            })}
          </ul>

          <ul className="storage__rows">
            {data.breakdown.map((row) => {
              const meta = LABELS[row.kind];
              return (
                <li key={row.kind}>
                  <span className="storage__row-label">{meta.label}</span>
                  <span className="storage__row-count">
                    {row.count > 0 ? `${row.count} ${plural(row.count, meta.unit, meta.plural)}` : 'none'}
                  </span>
                  <span className="storage__row-size">{row.bytes > 0 ? size(row.bytes) : '0 KB'}</span>
                </li>
              );
            })}
          </ul>

          <p className="storage__note storage__note--quiet">
            Videos are counted at a full chunk each, so this can read a few hundred kilobytes high.
            Captions, comments and indexes add under a megabyte.
          </p>

          {data.reclaimable.posts > 0 ? (
            <div className="storage__reclaim">
              <div className="storage__reclaim-copy">
                <p className="storage__reclaim-title">
                  {data.reclaimable.posts}{' '}
                  {plural(data.reclaimable.posts, 'post')} rejected or removed
                </p>
                <p className="storage__note">
                  Deleting them frees {size(data.reclaimable.bytes)}. It is permanent, and they
                  leave the moderation history too.
                </p>
              </div>
              {confirming ? (
                <div className="storage__reclaim-actions">
                  <button
                    type="button"
                    className="btn btn--danger btn--sm"
                    onClick={deleteRejected}
                    disabled={purging}
                  >
                    {purging ? 'Deleting…' : 'Delete permanently'}
                  </button>
                  <button
                    type="button"
                    className="btn btn--quiet btn--sm"
                    onClick={() => setConfirming(false)}
                    disabled={purging}
                  >
                    Keep
                  </button>
                </div>
              ) : (
                <div className="storage__reclaim-actions">
                  <button
                    type="button"
                    className="btn btn--quiet btn--sm"
                    onClick={() => setConfirming(true)}
                  >
                    Delete them
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

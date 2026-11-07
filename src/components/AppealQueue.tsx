import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AppealDTO } from '../../shared/types.ts';
import { api } from '../lib/api.ts';
import { useToast } from '../lib/toast.tsx';
import { formatDate, timeAgo } from '../lib/format.ts';
import { Icon } from '../components/Icon.tsx';
import { RowSkeleton } from '../components/Skeleton.tsx';

const KIND_LABEL: Record<AppealDTO['kind'], string> = {
  ban: 'Suspension appeal',
  warning: 'Warning appeal',
};

const MAIL_NOTE: Record<string, string> = {
  sent: 'Notice emailed',
  failed: 'Notice email failed',
  skipped: 'Not emailed (no provider configured)',
};

/**
 * Appeals waiting on a person. Accepting a suspension appeal restores the
 * account and the posts that were hidden with it; accepting a warning appeal
 * takes that warning off the count.
 */
export function AppealQueue({ onChanged }: { onChanged: () => void }) {
  const { notify } = useToast();
  const [view, setView] = useState<'open' | 'resolved'>('open');
  const [items, setItems] = useState<AppealDTO[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<{ items: AppealDTO[] }>(`/api/admin/appeals?status=${view}`)
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
        setSelectedId((current) =>
          current && data.items.some((item) => item.id === current) ? current : data.items[0]?.id ?? null,
        );
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Appeals could not load.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [view, version]);

  const selected = items.find((item) => item.id === selectedId) ?? null;

  const decide = async (action: 'accept' | 'decline') => {
    if (!selected) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await api.post<{ message?: string }>(`/api/admin/appeals/${selected.id}/resolve`, {
        action,
        note: note.trim() || undefined,
      });
      notify(result.message ?? 'Decision saved.');
      setNote('');
      setVersion((current) => current + 1);
      onChanged();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'That did not go through.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-layout">
      <div className="admin-list">
        <div className="admin-list__search">
          <div className="admin-subtabs" role="group" aria-label="Appeal state">
            <button
              type="button"
              className={`admin-subtab${view === 'open' ? ' is-active' : ''}`}
              aria-pressed={view === 'open'}
              onClick={() => setView('open')}
            >
              Waiting
            </button>
            <button
              type="button"
              className={`admin-subtab${view === 'resolved' ? ' is-active' : ''}`}
              aria-pressed={view === 'resolved'}
              onClick={() => setView('resolved')}
            >
              Decided
            </button>
          </div>
        </div>

        {loading ? (
          <RowSkeleton count={4} label="Loading appeals" />
        ) : error ? (
          <div className="admin-loading">{error}</div>
        ) : items.length === 0 ? (
          <div className="admin-loading">
            {view === 'open' ? 'No appeals waiting. Nothing to answer.' : 'No appeals have been decided yet.'}
          </div>
        ) : (
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`queue-row${selectedId === item.id ? ' is-selected' : ''}`}
                  onClick={() => {
                    setSelectedId(item.id);
                    setActionError(null);
                    setNote('');
                  }}
                  aria-current={selectedId === item.id}
                >
                  <span className="queue-row__body">
                    <span className="queue-row__title">
                      {KIND_LABEL[item.kind]} · @{item.username}
                    </span>
                    <span className="queue-row__meta">
                      {item.warningCount} warning{item.warningCount === 1 ? '' : 's'} ·{' '}
                      {timeAgo(item.submittedAt ?? item.createdAt)}
                    </span>
                  </span>
                  <span className={`ticket-state ticket-state--${item.status === 'open' ? 'open' : 'closed'}`}>
                    {item.status === 'open' ? 'Waiting' : item.status === 'accepted' ? 'Accepted' : 'Declined'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="admin-detail">
        {!selected ? (
          <div className="admin-empty">Select an appeal to read it.</div>
        ) : (
          <>
            <div className="admin-detail__head">
              <div>
                <p className="admin-detail__kind">{KIND_LABEL[selected.kind]}</p>
                <h2>@{selected.username}</h2>
                <p className="section-note">
                  Submitted {formatDate(selected.submittedAt ?? selected.createdAt)} · {timeAgo(selected.submittedAt ?? selected.createdAt)}
                </p>
              </div>
              <span className={`ticket-state ticket-state--${selected.status === 'open' ? 'open' : 'closed'}`}>
                {selected.status === 'open' ? 'Waiting' : selected.status === 'accepted' ? 'Accepted' : 'Declined'}
              </span>
            </div>

            <dl className="admin-facts">
              <div>
                <dt>Account state</dt>
                <dd>{selected.accountStatus}</dd>
              </div>
              <div>
                <dt>Warnings on record</dt>
                <dd>{selected.warningCount}</dd>
              </div>
              <div>
                <dt>Reply to</dt>
                <dd>
                  <a className="textlink" href={`mailto:${selected.email}`}>
                    {selected.email}
                  </a>
                </dd>
              </div>
              <div>
                <dt>Notice</dt>
                <dd>{selected.mailStatus ? MAIL_NOTE[selected.mailStatus] : 'No notice recorded'}</dd>
              </div>
            </dl>

            <p className="admin-detail__kind">The reason they are appealing</p>
            <p className="ticket-message">{selected.reason}</p>

            <p className="admin-detail__kind">What they wrote</p>
            <p className="ticket-message">{selected.message || 'Nothing was written.'}</p>

            {selected.status === 'open' ? (
              <>
                {actionError ? (
                  <p className="field__error" role="alert">
                    {actionError}
                  </p>
                ) : null}
                <div className="field">
                  <label className="field__label" htmlFor="appeal-note">
                    Note for them (optional, included in the email)
                  </label>
                  <textarea
                    id="appeal-note"
                    className="textarea"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Say why, especially when declining."
                    maxLength={400}
                  />
                </div>
                <div className="admin-actions">
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={busy}
                    onClick={() => decide('accept')}
                  >
                    {busy ? <span className="btn__spinner" /> : <Icon name="check" size={17} />}
                    {selected.kind === 'ban' ? 'Accept and reinstate' : 'Accept and clear the warning'}
                  </button>
                  <button type="button" className="btn btn--danger" disabled={busy} onClick={() => decide('decline')}>
                    Decline
                  </button>
                  <Link className="btn btn--quiet" to={`/u/${selected.username}`}>
                    Open profile
                  </Link>
                </div>
              </>
            ) : (
              <div className="admin-actions">
                <Link className="btn btn--quiet" to={`/u/${selected.username}`}>
                  Open profile
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

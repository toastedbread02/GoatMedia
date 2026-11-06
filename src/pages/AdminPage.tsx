import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import type {
  AdminPostDetail,
  AdminQueueItem,
  AdminReport,
  AdminUserRow,
  ModerationCounts,
} from '../../shared/types';
import { Icon } from '../components/Icon';
import { PhotoCarousel } from '../components/PhotoCarousel';
import { StatusBadge } from '../components/StatusBadge';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { count, fullDate, relativeTime } from '../lib/format';
import { useToast } from '../lib/toast';

type Section = 'queue' | 'reports' | 'accounts' | 'sounds';
type Status = 'pending' | 'approved' | 'rejected' | 'removed';

interface AdminSound {
  id: string;
  title: string;
  url: string;
  createdAt: number;
  ownerUsername: string;
  useCount: number;
  postCount: number;
  size: number;
  durationMs: number;
}

export function AdminPage() {
  const { me, loading } = useAuth();

  if (loading) return <div className="column" aria-busy="true" />;

  if (!me) {
    return (
      <div className="column column--reading">
        <div className="empty">
          <Icon name="shield" size={26} />
          <p className="empty__title">Moderation is protected</p>
          <p>Sign in with the moderator account to review posts.</p>
          <Link to="/signin" className="button">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  if (me.role !== 'admin') return <ClaimAdmin />;
  return <Dashboard />;
}

function ClaimAdmin() {
  const { refresh } = useAuth();
  const toast = useToast();
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="column column--reading">
      <div className="empty">
        <Icon name="shield" size={26} />
        <p className="empty__title">This area is for the GoatMedia moderator</p>
        <p>
          Permissions are checked on the server, so this page cannot be unlocked from the browser.
          If you run this deployment, the Worker has a one-time setup token that promotes the first
          account to moderator.
        </p>
      </div>
      <form
        className="form claim"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api.claimAdmin(token.trim());
            await refresh();
            toast('You are now the moderator', 'success');
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          <span className="field__label">Setup token</span>
          <input
            className="input"
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="ADMIN_SETUP_TOKEN"
            autoComplete="off"
          />
          <span className="field__hint">
            Set with <code>wrangler secret put ADMIN_SETUP_TOKEN</code>. It only works while no
            moderator exists.
          </span>
        </label>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="button" disabled={busy || !token.trim()}>
          {busy ? 'Checking…' : 'Claim moderator access'}
        </button>
      </form>
    </div>
  );
}

function Dashboard() {
  const toast = useToast();
  const [section, setSection] = useState<Section>('queue');
  const [status, setStatus] = useState<Status>('pending');
  const [counts, setCounts] = useState<ModerationCounts | null>(null);
  const [items, setItems] = useState<AdminQueueItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [accounts, setAccounts] = useState<AdminUserRow[]>([]);
  const [accountQuery, setAccountQuery] = useState('');
  const [sounds, setSounds] = useState<AdminSound[]>([]);

  const loadCounts = useCallback(async () => {
    try {
      setCounts(await api.adminCounts());
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  }, [toast]);

  const loadQueue = useCallback(
    async (nextStatus: Status, nextPage: number, replace = true) => {
      setLoading(true);
      try {
        const result = await api.adminQueue(nextStatus, nextPage);
        setItems((current) => (replace ? result.items : [...current, ...result.items]));
        setHasMore(result.hasMore);
        setPage(nextPage);
      } catch (error) {
        toast((error as Error).message, 'error');
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    void loadCounts();
  }, [loadCounts]);

  useEffect(() => {
    if (section === 'queue') void loadQueue(status, 1);
    if (section === 'reports') {
      api
        .adminReports('open')
        .then((result) => setReports(result.reports))
        .catch((error: Error) => toast(error.message, 'error'));
    }
    if (section === 'accounts') {
      api
        .adminUsers('')
        .then((result) => setAccounts(result.users))
        .catch((error: Error) => toast(error.message, 'error'));
    }
    if (section === 'sounds') {
      api
        .adminSounds()
        .then((result) => setSounds(result.sounds))
        .catch((error: Error) => toast(error.message, 'error'));
    }
  }, [section, status, loadQueue, toast]);

  const refreshAfterDecision = async () => {
    await Promise.all([loadCounts(), loadQueue(status, 1)]);
  };

  return (
    <div className="admin">
      <header className="page-head admin__head">
        <div>
          <h1 className="page-title">Moderation</h1>
          <p className="page-blurb">
            Every post waits here. Open one, look at the photos, then approve or reject with a
            reason the creator will read.
          </p>
        </div>
        {counts ? (
          <dl className="counts">
            <div>
              <dt>Waiting</dt>
              <dd>{counts.pending}</dd>
            </div>
            <div>
              <dt>Live</dt>
              <dd>{counts.approved}</dd>
            </div>
            <div>
              <dt>Reports</dt>
              <dd>{counts.openReports}</dd>
            </div>
            <div>
              <dt>Accounts</dt>
              <dd>{counts.users}</dd>
            </div>
          </dl>
        ) : null}
      </header>

      <div className="segmented segmented--wide" role="tablist" aria-label="Moderation sections">
        {(
          [
            ['queue', 'Queue'],
            ['reports', `Reports${counts?.openReports ? ` (${counts.openReports})` : ''}`],
            ['accounts', 'Accounts'],
            ['sounds', 'Sounds'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={section === value}
            className={section === value ? 'is-active' : ''}
            onClick={() => setSection(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {section === 'queue' ? (
        <>
          <div className="segmented segmented--subtle" role="tablist" aria-label="Post status">
            {(
              [
                ['pending', `Pending${counts ? ` (${counts.pending})` : ''}`],
                ['approved', 'Approved'],
                ['rejected', 'Rejected'],
                ['removed', 'Removed'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={status === value}
                className={status === value ? 'is-active' : ''}
                onClick={() => setStatus(value)}
              >
                {label}
              </button>
            ))}
          </div>

          {loading && items.length === 0 ? (
            <p className="feed__loading">Loading the queue…</p>
          ) : items.length === 0 ? (
            <div className="empty">
              <p className="empty__title">
                {status === 'pending' ? 'The queue is empty' : `No ${status} posts`}
              </p>
              <p>{status === 'pending' ? 'Nice. Go and look at some goats for fun.' : 'Nothing to show here.'}</p>
            </div>
          ) : (
            <ul className="queue">
              {items.map((item, index) => (
                <li key={item.id} style={{ '--i': Math.min(index, 8) } as CSSProperties}>
                  <button type="button" className="queue-row" onClick={() => setSelected(item.id)}>
                    <span className="queue-row__thumb">
                      {item.photos[0] ? <img src={item.photos[0].url} alt="" loading="lazy" /> : null}
                      {item.photos.length > 1 ? (
                        <span className="queue-row__count">{item.photos.length}</span>
                      ) : null}
                    </span>
                    <span className="queue-row__body">
                      <span className="queue-row__caption">{item.caption || 'No caption'}</span>
                      <span className="muted">
                        @{item.creator.username} · {item.categoryLabel} ·{' '}
                        {relativeTime(item.createdAt)}
                        {item.sound ? ` · sound: ${item.sound.title}` : ''}
                      </span>
                    </span>
                    <StatusBadge status={item.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {hasMore ? (
            <button
              type="button"
              className="button button--quiet"
              onClick={() => loadQueue(status, page + 1, false)}
            >
              Load more
            </button>
          ) : null}
        </>
      ) : null}

      {section === 'reports' ? (
        <ReportsSection
          reports={reports}
          onChanged={async () => {
            const result = await api.adminReports('open');
            setReports(result.reports);
            await loadCounts();
          }}
          onReview={(id) => setSelected(id)}
        />
      ) : null}

      {section === 'accounts' ? (
        <AccountsSection
          accounts={accounts}
          query={accountQuery}
          onQuery={setAccountQuery}
          onSearch={async (value) => {
            try {
              const result = await api.adminUsers(value);
              setAccounts(result.users);
            } catch (error) {
              toast((error as Error).message, 'error');
            }
          }}
          onChanged={async () => {
            const result = await api.adminUsers(accountQuery);
            setAccounts(result.users);
          }}
        />
      ) : null}

      {section === 'sounds' ? (
        <section aria-label="Sounds">
          <ul className="sound-admin">
            {sounds.map((sound) => (
              <li key={sound.id}>
                <div className="sound-admin__head">
                  <strong>{sound.title}</strong>
                  <span className="muted">
                    @{sound.ownerUsername} · {relativeTime(sound.createdAt)} · {sound.useCount} uses ·{' '}
                    {Math.round(sound.size / 1024)} KB
                  </span>
                </div>
                <audio controls preload="none" src={sound.url} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {selected ? (
        <ReviewDialog
          id={selected}
          onClose={() => setSelected(null)}
          onDecided={async () => {
            setSelected(null);
            await refreshAfterDecision();
          }}
        />
      ) : null}
    </div>
  );
}

function ReportsSection({
  reports,
  onChanged,
  onReview,
}: {
  reports: AdminReport[];
  onChanged: () => Promise<void>;
  onReview: (postId: string) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  if (reports.length === 0) {
    return (
      <div className="empty">
        <p className="empty__title">No open reports</p>
        <p>When someone flags a post, comment or account it lands here.</p>
      </div>
    );
  }

  return (
    <ul className="report-list">
      {reports.map((report) => (
        <li key={report.id} className="report-row">
          <div className="report-row__head">
            <strong>{report.reason}</strong>
            <span className="muted">
              {report.targetType} · reported by @{report.reporterUsername} ·{' '}
              {relativeTime(report.createdAt)}
            </span>
          </div>
          {report.note ? <p className="report-row__note">“{report.note}”</p> : null}
          {report.post ? (
            <p className="report-row__target">
              Post: “{report.post.caption || 'No caption'}” by @{report.post.creatorUsername} ·{' '}
              {report.post.status}
            </p>
          ) : null}
          {report.comment ? (
            <p className="report-row__target">
              Comment by @{report.comment.authorUsername}: “{report.comment.body}”
            </p>
          ) : null}
          {report.userTarget ? <p className="report-row__target">Account: @{report.userTarget}</p> : null}
          <div className="report-row__actions">
            {report.post ? (
              <button type="button" className="button button--quiet button--small" onClick={() => onReview(report.post!.id)}>
                Review post
              </button>
            ) : null}
            {report.comment ? (
              <button
                type="button"
                className="button button--quiet button--small"
                onClick={() => onReview(report.comment!.postId)}
              >
                Review post
              </button>
            ) : null}
            <button
              type="button"
              className="button button--quiet button--small"
              disabled={busy === report.id}
              onClick={async () => {
                setBusy(report.id);
                try {
                  await api.adminResolveReport(report.id, 'dismiss');
                  toast('Report dismissed');
                  await onChanged();
                } catch (error) {
                  toast((error as Error).message, 'error');
                } finally {
                  setBusy(null);
                }
              }}
            >
              Dismiss
            </button>
            <button
              type="button"
              className="button button--small"
              disabled={busy === report.id}
              onClick={async () => {
                setBusy(report.id);
                try {
                  await api.adminResolveReport(report.id, 'action');
                  toast('Marked as handled');
                  await onChanged();
                } catch (error) {
                  toast((error as Error).message, 'error');
                } finally {
                  setBusy(null);
                }
              }}
            >
              Mark handled
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function AccountsSection({
  accounts,
  query,
  onQuery,
  onSearch,
  onChanged,
}: {
  accounts: AdminUserRow[];
  query: string;
  onQuery: (value: string) => void;
  onSearch: (value: string) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const [suspendFor, setSuspendFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  return (
    <section aria-label="Accounts">
      <form
        className="search-form search-form--compact"
        onSubmit={(event) => {
          event.preventDefault();
          void onSearch(query);
        }}
      >
        <Icon name="search" size={18} />
        <label className="visually-hidden" htmlFor="account-search">
          Search accounts
        </label>
        <input
          id="account-search"
          className="search-form__input"
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Username, name or email"
        />
        <button type="submit" className="button button--small">
          Find
        </button>
      </form>

      <ul className="account-list">
        {accounts.map((account) => (
          <li key={account.id} className="account-row">
            <div className="account-row__main">
              <Link to={`/u/${account.username}`} className="account-row__name">
                {account.displayName} <span className="muted">@{account.username}</span>
              </Link>
              <span className="muted">
                {account.email} · joined {fullDate(account.createdAt)} · {count(account.postCount)}{' '}
                posts · {count(account.followerCount)} followers
                {account.suspendedReason ? ` · suspended: ${account.suspendedReason}` : ''}
              </span>
            </div>
            <div className="account-row__actions">
              {account.role === 'admin' ? (
                <span className="muted">Moderator</span>
              ) : account.status === 'suspended' ? (
                <button
                  type="button"
                  className="button button--quiet button--small"
                  onClick={async () => {
                    await api.adminSuspend(account.id, false);
                    toast('Account restored');
                    await onChanged();
                  }}
                >
                  Restore
                </button>
              ) : (
                <button
                  type="button"
                  className="button button--quiet button--small"
                  onClick={() => {
                    setSuspendFor(suspendFor === account.id ? null : account.id);
                    setReason('');
                  }}
                >
                  Suspend
                </button>
              )}
            </div>
            {suspendFor === account.id ? (
              <form
                className="suspend-form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (!reason.trim()) return;
                  try {
                    await api.adminSuspend(account.id, true, reason.trim());
                    toast('Account suspended');
                    setSuspendFor(null);
                    await onChanged();
                  } catch (error) {
                    toast((error as Error).message, 'error');
                  }
                }}
              >
                <label className="field">
                  <span className="field__label">Reason shown to the account</span>
                  <input
                    className="input"
                    value={reason}
                    maxLength={200}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Repeated uploads of sheep"
                    autoFocus
                  />
                </label>
                <button type="submit" className="button button--small" disabled={!reason.trim()}>
                  Suspend account
                </button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReviewDialog({
  id,
  onClose,
  onDecided,
}: {
  id: string;
  onClose: () => void;
  onDecided: () => Promise<void>;
}) {
  const toast = useToast();
  const [detail, setDetail] = useState<AdminPostDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | 'remove' | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .adminPost(id)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const decide = async (action: 'approve' | 'reject' | 'remove') => {
    if (action !== 'approve') {
      const final = customReason.trim() || reason;
      if (!final) {
        setError('Choose a reason first.');
        return;
      }
      setBusy(action);
      try {
        await api.adminDecide(id, action, final);
        toast(action === 'reject' ? 'Rejected with a reason' : 'Post removed');
        await onDecided();
      } catch (err) {
        setError((err as Error).message);
        setBusy(null);
      }
      return;
    }
    setBusy('approve');
    try {
      await api.adminDecide(id, 'approve');
      toast('Approved and published');
      await onDecided();
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="sheet-backdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="review" role="dialog" aria-modal="true" aria-label="Review post">
        <header className="review__head">
          <div>
            <h2 className="review__title">Review</h2>
            {detail ? (
              <p className="muted">
                @{detail.post.creator.username} · {detail.post.creatorEmail} · joined{' '}
                {fullDate(detail.post.creatorJoinedAt)}
              </p>
            ) : null}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close review">
            <Icon name="close" />
          </button>
        </header>

        {error ? <p className="form-error">{error}</p> : null}

        {!detail ? (
          <p className="feed__loading">Opening post…</p>
        ) : (
          <div className="review__body">
            <div className="review__media">
              <PhotoCarousel photos={detail.post.photos} caption={detail.post.caption} eager />
              {detail.post.sound ? (
                <div className="review__sound">
                  <p>
                    <Icon name="volume" size={16} /> {detail.post.sound.title} · @
                    {detail.post.sound.owner.username}
                  </p>
                  <audio controls preload="none" src={detail.post.sound.url} />
                </div>
              ) : (
                <p className="hint">No audio on this post.</p>
              )}
            </div>

            <div className="review__side">
              <div className="review__facts">
                <StatusBadge status={detail.post.status} />
                <p className="review__caption">{detail.post.caption || 'No caption'}</p>
                <dl className="fact-list fact-list--tight">
                  <div>
                    <dt>Category</dt>
                    <dd>{detail.post.categoryLabel}</dd>
                  </div>
                  <div>
                    <dt>Tags</dt>
                    <dd>{detail.post.hashtags.length ? detail.post.hashtags.map((t) => `#${t}`).join(' ') : 'None'}</dd>
                  </div>
                  <div>
                    <dt>Photos</dt>
                    <dd>{detail.post.photos.length}</dd>
                  </div>
                  <div>
                    <dt>Submitted</dt>
                    <dd>{fullDate(detail.post.createdAt)}</dd>
                  </div>
                </dl>
              </div>

              <div className="review__history">
                <h3>History</h3>
                <ul>
                  {detail.history.map((event) => (
                    <li key={event.id}>
                      <strong>{event.action}</strong>
                      <span className="muted">
                        {relativeTime(event.createdAt)}
                        {event.adminUsername ? ` · ${event.adminUsername}` : ''}
                        {event.reason ? ` · ${event.reason}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {detail.reports.length ? (
                <div className="review__history">
                  <h3>Reports on this post</h3>
                  <ul>
                    {detail.reports.map((report) => (
                      <li key={report.id}>
                        <strong>{report.reason}</strong>
                        <span className="muted">
                          @{report.reporterUsername} · {report.status}
                          {report.note ? ` · ${report.note}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="review__actions">
                {detail.post.status !== 'approved' ? (
                  <button
                    type="button"
                    className="button button--wide"
                    onClick={() => decide('approve')}
                    disabled={busy !== null}
                  >
                    <Icon name="check" size={17} />
                    {busy === 'approve' ? 'Approving…' : detail.post.status === 'pending' ? 'Approve and publish' : 'Put it live'}
                  </button>
                ) : null}

                <label className="field">
                  <span className="field__label">Reason for rejecting or removing</span>
                  <select className="select" value={reason} onChange={(event) => setReason(event.target.value)}>
                    <option value="">Choose a reason…</option>
                    {detail.rejectionReasons.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input"
                    value={customReason}
                    maxLength={200}
                    onChange={(event) => setCustomReason(event.target.value)}
                    placeholder="Or write your own"
                  />
                </label>
                <div className="review__buttons">
                  <button
                    type="button"
                    className="button button--quiet"
                    onClick={() => decide('reject')}
                    disabled={busy !== null}
                  >
                    {busy === 'reject' ? 'Rejecting…' : 'Reject'}
                  </button>
                  <button
                    type="button"
                    className="button button--danger"
                    onClick={() => decide('remove')}
                    disabled={busy !== null}
                  >
                    {busy === 'remove' ? 'Removing…' : 'Remove'}
                  </button>
                </div>
                <p className="hint">
                  The creator sees the reason. Rejecting keeps the post visible to them under “In
                  review”, removing hides it everywhere.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

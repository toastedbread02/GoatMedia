import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type {
  AdminQueueItem,
  AdminUserRow,
  ModerationCounts,
  ModerationEventDTO,
  ReportDTO,
} from '../../shared/types.ts';
import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useConfig } from '../lib/config.tsx';
import { useToast } from '../lib/toast.tsx';
import { clearFeedCache } from '../lib/feedCache.ts';
import { useDebouncedValue, useDocumentTitle } from '../lib/hooks.ts';
import { compactNumber, formatDate, timeAgo } from '../lib/format.ts';
import { Avatar } from '../components/Avatar.tsx';
import { Icon } from '../components/Icon.tsx';
import { Player } from '../components/Player.tsx';
import { AuthorizedImage, AuthorizedPlayer } from '../components/AuthorizedMedia.tsx';
import { PhotoAlbum } from '../components/PhotoAlbum.tsx';
import { SoundStrip } from '../components/SoundStrip.tsx';
import { StatusTag } from '../components/StatusTag.tsx';
import { AdminSkeleton, RowSkeleton } from '../components/Skeleton.tsx';
import { SupportQueue } from '../components/SupportQueue.tsx';
import { TrafficPanel } from '../components/TrafficPanel.tsx';
import { StoragePanel } from '../components/StoragePanel.tsx';

type Tab = 'pending' | 'approved' | 'rejected' | 'removed' | 'reports' | 'accounts' | 'traffic';
type ReportView = 'content' | 'support';

const VIDEO_TAB_STATUS: Record<string, string> = {
  pending: 'pending',
  approved: 'approved',
  rejected: 'rejected',
  removed: 'removed',
};

const ACTION_LABEL: Record<ModerationEventDTO['action'], string> = {
  submit: 'Submitted for review',
  approve: 'Approved and published',
  reject: 'Rejected',
  remove: 'Removed',
  resubmit: 'Resubmitted after an edit',
};

function History({ events }: { events: ModerationEventDTO[] }) {
  return (
    <ol className="history">
      {events.map((event) => (
        <li key={event.id} className="history__item">
          <span className="history__dot" aria-hidden="true" />
          <div>
            <p className="history__action">{ACTION_LABEL[event.action]}</p>
            {event.reason ? <p className="history__reason">{event.reason}</p> : null}
            <p className="history__meta">
              {timeAgo(event.createdAt)}
              {event.adminUsername ? ` · by @${event.adminUsername}` : ''}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function AdminPage() {
  useDocumentTitle('Moderation');
  const { user, loading, refresh: refreshSession } = useAuth();
  const config = useConfig();
  const { notify } = useToast();
  const isAdmin = user?.role === 'admin';
  const [searchParams] = useSearchParams();

  const [tab, setTab] = useState<Tab>(() => {
    const requested = searchParams.get('tab');
    return requested === 'reports' || requested === 'accounts' || requested === 'traffic'
      ? requested
      : 'pending';
  });
  const [reportView, setReportView] = useState<ReportView>(() =>
    searchParams.get('view') === 'support' ? 'support' : 'content',
  );
  const focusTicket = searchParams.get('ticket');
  const [counts, setCounts] = useState<ModerationCounts | null>(null);
  const [videos, setVideos] = useState<AdminQueueItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reports, setReports] = useState<ReportDTO[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AdminUserRow[]>([]);
  const [accountQuery, setAccountQuery] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const debouncedAccountQuery = useDebouncedValue(accountQuery, 280);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectPreset, setRejectPreset] = useState('');
  const [rejectNote, setRejectNote] = useState('');
  const [removing, setRemoving] = useState(false);
  const [removeReason, setRemoveReason] = useState('');
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');
  const [removeAccountOpen, setRemoveAccountOpen] = useState(false);
  const [removeAccountReason, setRemoveAccountReason] = useState('');
  const [claimToken, setClaimToken] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    setSelectedId(null);
    setSelectedReportId(null);
    setSelectedUserId(null);
    setRejecting(false);
    setRemoving(false);
    setSuspendOpen(false);
    setRemoveAccountOpen(false);
    setActionError(null);
  }, [tab, isAdmin]);

  // Notifications for support requests deep-link to a specific ticket.
  useEffect(() => {
    const requested = searchParams.get('tab');
    if (requested === 'reports' || requested === 'accounts' || requested === 'traffic') setTab(requested);
    if (requested === 'reports') {
      setReportView(searchParams.get('view') === 'support' ? 'support' : 'content');
    }
  }, [searchParams]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    setLoadingList(true);
    setListError(null);

    const load = async () => {
      try {
        const nextCounts = await api.get<ModerationCounts>('/api/admin/counts');
        if (cancelled) return;
        setCounts(nextCounts);
        if (tab === 'traffic') {
          // The traffic panel loads its own numbers.
          return;
        }
        if (tab === 'reports') {
          const data = await api.get<{ items: ReportDTO[] }>('/api/admin/reports?status=open');
          if (cancelled) return;
          setReports(data.items);
          setSelectedReportId((current) => (data.items.some((item) => item.id === current) ? current : data.items[0]?.id ?? null));
        } else if (tab === 'accounts') {
          const data = await api.get<{ items: AdminUserRow[] }>(
            `/api/admin/users?q=${encodeURIComponent(debouncedAccountQuery)}`,
          );
          if (cancelled) return;
          setAccounts(data.items);
          setSelectedUserId((current) => (data.items.some((item) => item.id === current) ? current : data.items[0]?.id ?? null));
        } else {
          const data = await api.get<{ items: AdminQueueItem[]; hasMore: boolean }>(
            `/api/admin/videos?status=${VIDEO_TAB_STATUS[tab]}&page=1`,
          );
          if (cancelled) return;
          setVideos(data.items);
          setHasMore(data.hasMore);
          setPage(1);
          setSelectedId((current) => (data.items.some((item) => item.id === current) ? current : data.items[0]?.id ?? null));
        }
      } catch (error) {
        if (!cancelled) setListError(error instanceof Error ? error.message : 'The moderation queue could not load.');
      } finally {
        if (!cancelled) setLoadingList(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [tab, isAdmin, debouncedAccountQuery]);

  const refresh = async () => {
    try {
      const nextCounts = await api.get<ModerationCounts>('/api/admin/counts');
      setCounts(nextCounts);
      if (tab === 'reports') {
        const data = await api.get<{ items: ReportDTO[] }>('/api/admin/reports?status=open');
        setReports(data.items);
        setSelectedReportId((current) => (data.items.some((item) => item.id === current) ? current : data.items[0]?.id ?? null));
      } else if (tab === 'accounts') {
        const data = await api.get<{ items: AdminUserRow[] }>(
          `/api/admin/users?q=${encodeURIComponent(debouncedAccountQuery)}`,
        );
        setAccounts(data.items);
        setSelectedUserId((current) => (data.items.some((item) => item.id === current) ? current : data.items[0]?.id ?? null));
      } else {
        const data = await api.get<{ items: AdminQueueItem[]; hasMore: boolean }>(
          `/api/admin/videos?status=${VIDEO_TAB_STATUS[tab]}&page=1`,
        );
        setVideos(data.items);
        setHasMore(data.hasMore);
        setPage(1);
        setSelectedId((current) => (data.items.some((item) => item.id === current) ? current : data.items[0]?.id ?? null));
      }
    } catch {
      /* the visible list stays usable */
    }
  };

  const runAction = async (action: () => Promise<{ message?: string }>) => {
    setBusy(true);
    setActionError(null);
    try {
      const result = await action();
      notify(result.message ?? 'Done.');
      clearFeedCache();
      setRejecting(false);
      setRemoving(false);
      setSuspendOpen(false);
      setRemoveAccountOpen(false);
      setRemoveAccountReason('');
      setRejectPreset('');
      setRejectNote('');
      setRemoveReason('');
      setSuspendReason('');
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'That action did not go through.');
    } finally {
      setBusy(false);
    }
  };

  const loadMore = async () => {
    try {
      const data = await api.get<{ items: AdminQueueItem[]; hasMore: boolean }>(
        `/api/admin/videos?status=${VIDEO_TAB_STATUS[tab]}&page=${page + 1}`,
      );
      setVideos((current) => [...current, ...data.items]);
      setHasMore(data.hasMore);
      setPage((current) => current + 1);
    } catch {
      notify('Could not load more.', { tone: 'error' });
    }
  };

  if (loading) return <AdminSkeleton />;

  if (!isAdmin) {
    const claim = async (event: FormEvent) => {
      event.preventDefault();
      setClaiming(true);
      setClaimError(null);
      try {
        await api.post('/api/admin/claim', { token: claimToken.trim() });
        setClaimToken('');
        await refreshSession();
        notify('You are the moderator now.');
      } catch (error) {
        setClaimError(error instanceof Error ? error.message : 'That setup code did not work.');
      } finally {
        setClaiming(false);
      }
    };

    return (
      <div className="page">
        <div className="empty-state" style={{ paddingTop: 48 }}>
          <Icon name="shield" size={26} />
          <h2>Moderation is for the moderator</h2>
          {!user ? (
            <>
              <p>Sign in with the account that should review uploads, then claim the role with your setup code.</p>
              <Link className="btn btn--primary" to="/login?next=/admin">
                Sign in
              </Link>
            </>
          ) : !config ? (
            <div className="spinner spinner--dark" />
          ) : config.adminClaimable ? (
            <>
              <p>
                Paste the setup code from your server to make this account the moderator. The role is granted on the
                server, not in the browser.
              </p>
              <form className="form-stack" onSubmit={claim} style={{ maxWidth: 340 }}>
                <div className="field">
                  <label className="field__label" htmlFor="claim-token">
                    Setup code
                  </label>
                  <input
                    id="claim-token"
                    className="input"
                    type="password"
                    value={claimToken}
                    onChange={(event) => setClaimToken(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    required
                  />
                  {claimError ? (
                    <p className="field__error" role="alert">
                      {claimError}
                    </p>
                  ) : null}
                </div>
                <button type="submit" className="btn btn--primary" disabled={claiming || !claimToken.trim()}>
                  {claiming ? <span className="btn__spinner" /> : null}
                  Claim moderator role
                </button>
              </form>
            </>
          ) : (
            <>
              <p>This installation already has a moderator, so this account cannot claim it.</p>
              <Link className="btn btn--quiet" to="/">
                Back to the feed
              </Link>
            </>
          )}
        </div>
      </div>
    );
  }

  const selected = videos.find((item) => item.id === selectedId) ?? null;
  const selectedReport = reports.find((item) => item.id === selectedReportId) ?? null;
  const selectedAccount = accounts.find((item) => item.id === selectedUserId) ?? null;
  const videoTabs: Tab[] = ['pending', 'approved', 'rejected', 'removed'];

  return (
    <div className="page page--wide admin-page">
      <div className="page-head admin-head">
        <div>
          <h1 className="page-title">Moderation</h1>
          <p className="page-sub">
            Every upload waits for you. Approve only what you have actually watched.
          </p>
        </div>
        <div className="admin-head__counts">
          <span>
            <strong>{counts?.pending ?? 0}</strong> waiting
          </span>
          <span>
            <strong>{(counts?.openReports ?? 0) + (counts?.openTickets ?? 0)}</strong> open reports
          </span>
          <span>
            <strong>{counts?.openTickets ?? 0}</strong> support
          </span>
        </div>
      </div>

      <div className="admin-tabs" role="tablist" aria-label="Moderation sections">
        {videoTabs.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={tab === item}
            className={`admin-tab${tab === item ? ' is-active' : ''}`}
            onClick={() => setTab(item)}
          >
            {item === 'pending' ? 'Pending' : item === 'approved' ? 'Approved' : item === 'rejected' ? 'Rejected' : 'Removed'}
            <span className="admin-tab__count">{counts?.[item as keyof ModerationCounts] ?? 0}</span>
          </button>
        ))}
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'reports'}
          className={`admin-tab${tab === 'reports' ? ' is-active' : ''}`}
          onClick={() => {
            setTab('reports');
            setReportView('content');
          }}
        >
          Report center
          <span className="admin-tab__count">{(counts?.openReports ?? 0) + (counts?.openTickets ?? 0)}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'accounts'}
          className={`admin-tab${tab === 'accounts' ? ' is-active' : ''}`}
          onClick={() => setTab('accounts')}
        >
          Control center
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'traffic'}
          className={`admin-tab${tab === 'traffic' ? ' is-active' : ''}`}
          onClick={() => setTab('traffic')}
        >
          Traffic
        </button>
      </div>

      {listError ? (
        <div className="notice notice--error">
          <Icon name="alert" size={18} />
          <p>{listError}</p>
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => setTab(tab)}>
            Reload
          </button>
        </div>
      ) : null}

      {tab === 'traffic' ? (
        <>
          <TrafficPanel />
          <StoragePanel />
        </>
      ) : tab === 'reports' ? (
        <>
          <div className="admin-subtabs" role="group" aria-label="Report type">
            <button
              type="button"
              className={`admin-subtab${reportView === 'content' ? ' is-active' : ''}`}
              aria-pressed={reportView === 'content'}
              onClick={() => setReportView('content')}
            >
              Content reports <span>{counts?.openReports ?? 0}</span>
            </button>
            <button
              type="button"
              className={`admin-subtab${reportView === 'support' ? ' is-active' : ''}`}
              aria-pressed={reportView === 'support'}
              onClick={() => setReportView('support')}
            >
              Support requests <span>{counts?.openTickets ?? 0}</span>
            </button>
          </div>

          {reportView === 'support' ? (
            <SupportQueue
              focusTicket={focusTicket}
              onChanged={refresh}
              onManageAccount={(username) => {
                setAccountQuery(username);
                setTab('accounts');
              }}
            />
          ) : (
        <div className="admin-layout">
          <div className="admin-list">
            {loadingList ? (
              <RowSkeleton count={4} label="Loading reports" />
            ) : reports.length === 0 ? (
              <div className="admin-loading">No open reports. Quiet week for goats.</div>
            ) : (
              <ul>
                {reports.map((report) => (
                  <li key={report.id}>
                    <button
                      type="button"
                      className={`queue-row${selectedReportId === report.id ? ' is-selected' : ''}`}
                      onClick={() => setSelectedReportId(report.id)}
                      aria-current={selectedReportId === report.id}
                    >
                      <span className="queue-row__body">
                        <span className="queue-row__title">
                          {report.targetType === 'video'
                            ? report.video?.caption || 'Reported video'
                            : report.comment?.body || 'Reported comment'}
                        </span>
                        <span className="queue-row__meta">
                          {report.reason} · @{report.reporterUsername} · {timeAgo(report.createdAt)}
                        </span>
                      </span>
                      <span className={`queue-row__type ${report.targetType}`}>{report.targetType}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="admin-detail">
            {!selectedReport ? (
              <div className="admin-empty">Select a report to see it.</div>
            ) : (
              <>
                <div className="admin-detail__head">
                  <div>
                    <p className="admin-detail__kind">Report · {selectedReport.targetType}</p>
                    <h2>{selectedReport.reason}</h2>
                    <p className="section-note">
                      Sent by @{selectedReport.reporterUsername} {timeAgo(selectedReport.createdAt)}
                    </p>
                  </div>
                  <StatusTag status={selectedReport.status === 'open' ? 'pending' : 'approved'} />
                </div>

                {selectedReport.note ? <p className="report-note">{selectedReport.note}</p> : null}

                {selectedReport.video ? (
                  <div className="report-target">
                    {selectedReport.video.kind === 'video' && selectedReport.video.videoUrl ? (
                      <AuthorizedPlayer
                        key={selectedReport.video.id}
                        src={selectedReport.video.videoUrl}
                        active
                      />
                    ) : selectedReport.video.posterUrl ? (
                      <AuthorizedImage
                        className="report-target__photo"
                        src={selectedReport.video.posterUrl}
                        fallbackSize={22}
                      />
                    ) : null}
                    <div className="report-target__meta">
                      <Link className="textlink" to={`/v/${selectedReport.video.id}`}>
                        {selectedReport.video.caption || 'Open video'}
                      </Link>
                      <span className="section-note">
                        @{selectedReport.video.creatorUsername} · {selectedReport.video.status}
                      </span>
                    </div>
                  </div>
                ) : selectedReport.comment ? (
                  <div className="report-comment">
                    <p>“{selectedReport.comment.body}”</p>
                    <p className="section-note">
                      @{selectedReport.comment.authorUsername} ·{' '}
                      <Link className="textlink" to={`/v/${selectedReport.comment.videoId}`}>
                        View the video
                      </Link>
                    </p>
                  </div>
                ) : null}

                {actionError ? <p className="field__error">{actionError}</p> : null}
                <div className="admin-actions">
                  {selectedReport.targetType === 'user' ? (
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={() => {
                        setAccountQuery(selectedReport.userTarget ?? '');
                        setTab('accounts');
                      }}
                    >
                      Open account controls
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--primary"
                      disabled={busy}
                      onClick={() => runAction(() => api.post(`/api/admin/reports/${selectedReport.id}/resolve`, { action: 'remove_content' }))}
                    >
                      Remove content
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn--quiet"
                    disabled={busy}
                    onClick={() => runAction(() => api.post(`/api/admin/reports/${selectedReport.id}/resolve`, { action: 'dismiss' }))}
                  >
                    Dismiss report
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
          )}
        </>
      ) : tab === 'accounts' ? (
        <div className="admin-layout">
          <div className="admin-list">
            <p className="admin-list__note">
              Suspend signs an account out and hides their posts. Remove hides the account and its content but keeps it
              recoverable. Make moderator lets someone else share the review and account work.
            </p>
            <div className="admin-list__search">
              <div className="searchbox">
                <Icon name="search" size={17} />
                <input
                  className="input"
                  type="search"
                  placeholder="Search accounts"
                  aria-label="Search accounts"
                  value={accountQuery}
                  onChange={(event) => setAccountQuery(event.target.value)}
                />
              </div>
            </div>
            {loadingList ? (
              <RowSkeleton count={4} label="Loading accounts" />
            ) : accounts.length === 0 ? (
              <div className="admin-loading">No accounts match that search.</div>
            ) : (
              <ul>
                {accounts.map((account) => (
                  <li key={account.id}>
                    <button
                      type="button"
                      className={`queue-row${selectedUserId === account.id ? ' is-selected' : ''}`}
                      onClick={() => setSelectedUserId(account.id)}
                      aria-current={selectedUserId === account.id}
                    >
                      <Avatar displayName={account.displayName} username={account.username} size={30} />
                      <span className="queue-row__body">
                        <span className="queue-row__title">{account.displayName}</span>
                        <span className="queue-row__meta">
                          @{account.username}
                          {account.role === 'admin' ? ' · Moderator' : ''} · {account.videoCount} videos
                        </span>
                      </span>
                      {account.status === 'deleted' ? (
                        <span className="queue-row__type">Removed</span>
                      ) : account.status === 'suspended' ? (
                        <span className="queue-row__type">Suspended</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="admin-detail">
            {!selectedAccount ? (
              <div className="admin-empty">Select an account.</div>
            ) : (
              <>
                <div className="admin-detail__head">
                  <div className="creator">
                    <Avatar
                      displayName={selectedAccount.displayName}
                      username={selectedAccount.username}
                      size={44}
                    />
                    <div>
                      <h2>{selectedAccount.displayName}</h2>
                      <p className="section-note">@{selectedAccount.username}</p>
                    </div>
                  </div>
                  <span
                    className={`status-tag status-tag--${selectedAccount.status === 'active' ? 'approved' : 'rejected'}`}
                  >
                    {selectedAccount.status === 'deleted'
                      ? 'Removed'
                      : selectedAccount.status === 'suspended'
                        ? 'Suspended'
                        : 'Active'}
                  </span>
                </div>

                <dl className="admin-facts">
                  <div>
                    <dt>Email</dt>
                    <dd>{selectedAccount.email}</dd>
                  </div>
                  <div>
                    <dt>Joined</dt>
                    <dd>{formatDate(selectedAccount.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>Videos</dt>
                    <dd>{selectedAccount.videoCount}</dd>
                  </div>
                  <div>
                    <dt>Followers</dt>
                    <dd>{compactNumber(selectedAccount.followerCount)}</dd>
                  </div>
                  <div>
                    <dt>Role</dt>
                    <dd>{selectedAccount.role === 'admin' ? 'Moderator' : 'Member'}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>
                      {selectedAccount.status === 'deleted'
                        ? 'Removed'
                        : selectedAccount.status === 'suspended'
                          ? 'Suspended'
                          : 'Active'}
                    </dd>
                  </div>
                </dl>

                {selectedAccount.deletedReason ? (
                  <p className="report-note">Removal reason: {selectedAccount.deletedReason}</p>
                ) : selectedAccount.suspendedReason ? (
                  <p className="report-note">Suspension reason: {selectedAccount.suspendedReason}</p>
                ) : null}

                <div className="admin-actions">
                  {selectedAccount.status !== 'deleted' ? (
                    <Link className="btn btn--quiet btn--sm" to={`/u/${selectedAccount.username}`}>
                      Open profile
                    </Link>
                  ) : null}
                  {selectedAccount.id === user?.id ? (
                    <span className="section-note">This is your own account.</span>
                  ) : selectedAccount.role === 'admin' ? (
                    <>
                      <span className="section-note">
                        Moderator accounts cannot be suspended or removed here.
                      </span>
                      <button
                        type="button"
                        className="btn btn--quiet btn--sm"
                        disabled={busy}
                        onClick={() =>
                          runAction(() => api.delete(`/api/admin/users/${selectedAccount.id}/moderator`))
                        }
                      >
                        Remove moderator access
                      </button>
                    </>
                  ) : selectedAccount.status === 'deleted' ? (
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      disabled={busy}
                      onClick={() => runAction(() => api.post(`/api/admin/users/${selectedAccount.id}/restore`))}
                    >
                      Restore account
                    </button>
                  ) : (
                    <>
                      {selectedAccount.status === 'suspended' ? (
                        <button
                          type="button"
                          className="btn btn--primary btn--sm"
                          disabled={busy}
                          onClick={() => runAction(() => api.post(`/api/admin/users/${selectedAccount.id}/unsuspend`))}
                        >
                          Reinstate account
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="btn btn--quiet btn--sm"
                            disabled={busy}
                            onClick={() =>
                              runAction(() => api.post(`/api/admin/users/${selectedAccount.id}/moderator`))
                            }
                          >
                            Make moderator
                          </button>
                          <button
                            type="button"
                            className="btn btn--danger btn--sm"
                            onClick={() => {
                              setSuspendOpen((current) => !current);
                              setRemoveAccountOpen(false);
                            }}
                          >
                            Suspend account
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        className="btn btn--danger btn--sm"
                        onClick={() => {
                          setRemoveAccountOpen((current) => !current);
                          setSuspendOpen(false);
                        }}
                      >
                        Remove account
                      </button>
                    </>
                  )}
                </div>

                {suspendOpen ? (
                  <div className="mod-panel">
                    <div className="field">
                      <label className="field__label" htmlFor="suspend-reason">
                        Reason for suspension
                      </label>
                      <textarea
                        id="suspend-reason"
                        className="textarea"
                        value={suspendReason}
                        onChange={(event) => setSuspendReason(event.target.value)}
                        placeholder="Shown to the account holder if they contact you."
                      />
                    </div>
                    <div className="form-actions">
                      <button
                        type="button"
                        className="btn btn--danger btn--sm"
                        disabled={busy || suspendReason.trim().length < 3}
                        onClick={() =>
                          runAction(() =>
                            api.post(`/api/admin/users/${selectedAccount.id}/suspend`, { reason: suspendReason }),
                          )
                        }
                      >
                        Suspend
                      </button>
                      <button type="button" className="btn btn--quiet btn--sm" onClick={() => setSuspendOpen(false)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}

                {removeAccountOpen ? (
                  <div className="mod-panel">
                    <div className="field">
                      <label className="field__label" htmlFor="remove-account-reason">
                        Reason for removing the account
                      </label>
                      <textarea
                        id="remove-account-reason"
                        className="textarea"
                        value={removeAccountReason}
                        onChange={(event) => setRemoveAccountReason(event.target.value)}
                        placeholder="What happened? The reason is kept with the account so it can be reviewed if they ask to come back."
                      />
                    </div>
                    <p className="admin-hint">
                      The account is signed out, hidden from profiles, and its posts and comments come down. You can
                      restore the account later, but removed posts stay down.
                    </p>
                    <div className="form-actions">
                      <button
                        type="button"
                        className="btn btn--danger btn--sm"
                        disabled={busy || removeAccountReason.trim().length < 3}
                        onClick={() =>
                          runAction(() =>
                            api.post(`/api/admin/users/${selectedAccount.id}/remove`, {
                              reason: removeAccountReason,
                            }),
                          )
                        }
                      >
                        {busy ? <span className="btn__spinner" /> : null}
                        Remove account
                      </button>
                      <button
                        type="button"
                        className="btn btn--quiet btn--sm"
                        onClick={() => setRemoveAccountOpen(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="admin-layout">
          {!loadingList && videos.length === 0 ? (
            <div className="admin-empty admin-empty--wide">
              {tab === 'pending' ? 'Nothing waiting. Every goat is accounted for.' : 'Nothing here yet.'}
            </div>
          ) : (
            <>
          <div className="admin-list">
            {tab === 'pending' ? (
              <p className="admin-list__note">
                Oldest first. Approving publishes immediately; rejecting requires a reason the creator can see.
              </p>
            ) : null}
            {loadingList ? (
              <RowSkeleton count={5} label="Loading queue" />
            ) : (
              <ul>
                {videos.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`queue-row${selectedId === item.id ? ' is-selected' : ''}`}
                      onClick={() => setSelectedId(item.id)}
                      aria-current={selectedId === item.id}
                    >
                      <span className="queue-row__thumb">
                        {item.posterUrl ? (
                          item.status === 'approved' ? (
                            <img src={item.posterUrl} alt="" loading="lazy" />
                          ) : (
                            <AuthorizedImage src={item.posterUrl} fallbackIcon="play" />
                          )
                        ) : (
                          <Icon name="play" size={16} />
                        )}
                      </span>
                      <span className="queue-row__body">
                        <span className="queue-row__title">{item.caption || 'Untitled goat post'}</span>
                        <span className="queue-row__meta">
                          @{item.creator.username} · {timeAgo(item.createdAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {hasMore ? (
              <div className="admin-list__more">
                <button type="button" className="btn btn--quiet btn--sm" onClick={loadMore}>
                  Load more
                </button>
              </div>
            ) : null}
          </div>

          <div className="admin-detail">
            {!selected ? (
              <div className="admin-empty">
                {tab === 'pending' ? 'Nothing waiting for review.' : 'Select a video from the list.'}
              </div>
            ) : (
              <>
                <div className="admin-detail__player">
                  {selected.kind === 'video' && selected.videoUrl ? (
                    selected.status === 'approved' ? (
                      <Player
                        key={selected.id}
                        src={selected.videoUrl}
                        poster={selected.posterUrl}
                        active
                      />
                    ) : (
                      <AuthorizedPlayer key={selected.id} src={selected.videoUrl} active />
                    )
                  ) : (
                    <PhotoAlbum
                      key={selected.id}
                      photos={selected.photos}
                      caption={selected.caption}
                      eager
                      gated={selected.status !== 'approved'}
                    />
                  )}
                </div>

                {selected.kind === 'photos' && selected.sound ? (
                  <SoundStrip
                    key={selected.sound.id}
                    sound={selected.sound}
                    gated={selected.status !== 'approved'}
                  />
                ) : null}

                <div className="admin-detail__head">
                  <div>
                    <p className="admin-detail__kind">{selected.categoryLabel}</p>
                    <h2>{selected.caption || 'Untitled goat post'}</h2>
                    <p className="section-note">
                      Submitted {formatDate(selected.createdAt)} ·{' '}
                      {selected.kind === 'photos'
                        ? `${selected.photos.length} ${selected.photos.length === 1 ? 'photo' : 'photos'}`
                        : selected.duration
                          ? `${Math.round(selected.duration)}s`
                          : 'length unknown'}
                    </p>
                  </div>
                  <StatusTag status={selected.status} />
                </div>

                {selected.hashtags.length ? (
                  <p className="admin-tags">{selected.hashtags.map((tag) => `#${tag}`).join(' ')}</p>
                ) : null}

                <div className="admin-creator">
                  <Avatar
                    displayName={selected.creator.displayName}
                    username={selected.creator.username}
                    avatarUrl={selected.creator.avatarUrl}
                    size={38}
                  />
                  <div className="admin-creator__text">
                    <Link className="creator__name" to={`/u/${selected.creator.username}`}>
                      {selected.creator.displayName}
                    </Link>
                    <span className="creator__handle">@{selected.creator.username}</span>
                  </div>
                  <dl className="admin-creator__facts">
                    <div>
                      <dt>Email</dt>
                      <dd>{selected.creatorEmail}</dd>
                    </div>
                    <div>
                      <dt>Joined</dt>
                      <dd>{formatDate(selected.creatorJoinedAt)}</dd>
                    </div>
                    <div>
                      <dt>Uploads</dt>
                      <dd>{selected.creatorUploads}</dd>
                    </div>
                    <div>
                      <dt>Views</dt>
                      <dd>{compactNumber(selected.viewCount)}</dd>
                    </div>
                  </dl>
                </div>

                {actionError ? <p className="field__error">{actionError}</p> : null}

                {selected.status === 'pending' ? (
                  <>
                    {rejecting ? (
                      <div className="mod-panel">
                        <div className="field">
                          <label className="field__label" htmlFor="reject-preset">
                            Reason category
                          </label>
                          <select
                            id="reject-preset"
                            className="select"
                            value={rejectPreset}
                            onChange={(event) => setRejectPreset(event.target.value)}
                          >
                            <option value="">Choose a reason</option>
                            {(config?.rejectReasons ?? []).map((reason) => (
                              <option key={reason} value={reason}>
                                {reason}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="field">
                          <label className="field__label" htmlFor="reject-note">
                            Note for the creator
                          </label>
                          <textarea
                            id="reject-note"
                            className="textarea"
                            value={rejectNote}
                            onChange={(event) => setRejectNote(event.target.value)}
                            placeholder="Say what would need to change, or leave this blank."
                          />
                        </div>
                        <div className="form-actions">
                          <button
                            type="button"
                            className="btn btn--danger btn--sm"
                            disabled={busy || (!rejectPreset && rejectNote.trim().length < 3)}
                            onClick={() =>
                              runAction(() =>
                                api.post(`/api/admin/videos/${selected.id}/reject`, {
                                  reason: [rejectPreset, rejectNote.trim()].filter(Boolean).join(' — '),
                                }),
                              )
                            }
                          >
                            {busy ? <span className="btn__spinner" /> : null}
                            Reject post
                          </button>
                          <button type="button" className="btn btn--quiet btn--sm" onClick={() => setRejecting(false)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="admin-actions">
                        <button
                          type="button"
                          className="btn btn--primary btn--lg"
                          disabled={busy}
                          onClick={() => runAction(() => api.post(`/api/admin/videos/${selected.id}/approve`))}
                        >
                          {busy ? <span className="btn__spinner" /> : <Icon name="check" size={18} />}
                          Approve and publish
                        </button>
                        <button type="button" className="btn btn--quiet" onClick={() => setRejecting(true)}>
                          Reject
                        </button>
                      </div>
                    )}
                    <p className="admin-hint">
                      Approved posts appear in For You, Trending, search and the creator’s profile immediately.
                    </p>
                  </>
                ) : selected.status === 'approved' ? (
                  <>
                    {removing ? (
                      <div className="mod-panel">
                        <div className="field">
                          <label className="field__label" htmlFor="remove-reason">
                            Why is this coming down?
                          </label>
                          <input
                            id="remove-reason"
                            className="input"
                            value={removeReason}
                            onChange={(event) => setRemoveReason(event.target.value)}
                            placeholder="Rules issue, creator request, bad quality…"
                          />
                        </div>
                        <div className="form-actions">
                          <button
                            type="button"
                            className="btn btn--danger btn--sm"
                            disabled={busy}
                            onClick={() =>
                              runAction(() =>
                                api.post(`/api/admin/videos/${selected.id}/remove`, {
                                  reason: removeReason || 'Removed by the moderator',
                                }),
                              )
                            }
                          >
                            Remove from public
                          </button>
                          <button type="button" className="btn btn--quiet btn--sm" onClick={() => setRemoving(false)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="admin-actions">
                        <button
                          type="button"
                          className="btn btn--quiet"
                          disabled={busy}
                          onClick={() =>
                            runAction(() => api.post('/api/admin/daily', { postId: selected.id }))
                          }
                        >
                          <Icon name="spark" size={17} />
                          Make Goat of the day
                        </button>
                        <button
                          type="button"
                          className="btn btn--danger"
                          onClick={() => setRemoving(true)}
                          disabled={busy}
                        >
                          Remove from public
                        </button>
                        <Link className="btn btn--quiet" to={`/v/${selected.id}`}>
                          Open video page
                        </Link>
                      </div>
                    )}
                  </>
                ) : selected.status === 'rejected' ? (
                  <div className="admin-actions">
                    <button
                      type="button"
                      className="btn btn--primary"
                      disabled={busy}
                      onClick={() => runAction(() => api.post(`/api/admin/videos/${selected.id}/approve`))}
                    >
                      Approve after all
                    </button>
                  </div>
                ) : (
                  <p className="admin-hint">This video is removed and cannot be published again.</p>
                )}

                <div className="admin-history">
                  <h3>Moderation history</h3>
                  <History events={selected.moderationHistory} />
                </div>
              </>
            )}
          </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SupportTicketDTO } from '../../shared/types.ts';
import { api } from '../lib/api.ts';
import { useToast } from '../lib/toast.tsx';
import { formatDate, timeAgo } from '../lib/format.ts';
import { Avatar } from './Avatar.tsx';
import { Icon } from './Icon.tsx';

const STATE_LABEL: Record<SupportTicketDTO['status'], string> = {
  open: 'Open',
  reviewing: 'Reviewing',
  closed: 'Closed',
};

export function SupportQueue({
  focusTicket,
  onChanged,
  onManageAccount,
}: {
  focusTicket?: string | null;
  onChanged: () => void;
  onManageAccount: (username: string) => void;
}) {
  const { notify } = useToast();
  const [items, setItems] = useState<SupportTicketDTO[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [closingOpen, setClosingOpen] = useState(false);
  const [resolutionNote, setResolutionNote] = useState('');
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<{ items: SupportTicketDTO[] }>('/api/admin/tickets?status=open')
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
        setSelectedId((current) => {
          if (focusTicket && data.items.some((item) => item.id === focusTicket)) return focusTicket;
          if (current && data.items.some((item) => item.id === current)) return current;
          return data.items[0]?.id ?? null;
        });
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Support requests could not load.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [focusTicket, version]);

  const selected = items.find((item) => item.id === selectedId) ?? null;
  const openCount = items.filter((item) => item.status === 'open').length;

  const update = async (status: 'reviewing' | 'closed') => {
    if (!selected) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.post(`/api/admin/tickets/${selected.id}/resolve`, { status, note: resolutionNote });
      notify(status === 'closed' ? 'Support request closed.' : 'Marked as reviewing.');
      setClosingOpen(false);
      setResolutionNote('');
      setVersion((current) => current + 1);
      onChanged();
    } catch (updateError) {
      setActionError(updateError instanceof Error ? updateError.message : 'That did not go through.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="admin-list__note">
        Contact messages from the public. {openCount === 0 ? 'Nothing is waiting.' : `${openCount} still open.`}
      </p>
      <div className="admin-layout">
        <div className="admin-list">
          {loading ? (
            <div className="admin-loading">Loading support requests…</div>
          ) : error ? (
            <div className="admin-loading">
              {error}{' '}
              <button type="button" className="textlink" onClick={() => setVersion((current) => current + 1)}>
                Try again
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="admin-loading">No open support requests. Quiet week for goats.</div>
          ) : (
            <ul>
              {items.map((ticket) => (
                <li key={ticket.id}>
                  <button
                    type="button"
                    className={`queue-row${selectedId === ticket.id ? ' is-selected' : ''}`}
                    onClick={() => {
                      setSelectedId(ticket.id);
                      setClosingOpen(false);
                      setActionError(null);
                    }}
                    aria-current={selectedId === ticket.id}
                  >
                    {ticket.reporter ? (
                      <Avatar displayName={ticket.reporter.displayName} username={ticket.reporter.username} size={30} />
                    ) : (
                      <span className="ticket-guest" aria-hidden="true">
                        <Icon name="flag" size={15} />
                      </span>
                    )}
                    <span className="queue-row__body">
                      <span className="queue-row__title">{ticket.categoryLabel}</span>
                      <span className="queue-row__meta">
                        {ticket.reporter ? `@${ticket.reporter.username}` : ticket.email} · {timeAgo(ticket.createdAt)}
                      </span>
                    </span>
                    <span className={`ticket-state ticket-state--${ticket.status}`}>{STATE_LABEL[ticket.status]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="admin-detail">
          {!selected ? (
            <div className="admin-empty">Select a support request to read it.</div>
          ) : (
            <>
              <div className="admin-detail__head">
                <div>
                  <p className="admin-detail__kind">{selected.categoryLabel}</p>
                  <h2>{selected.reporter ? `@${selected.reporter.username}` : 'Guest message'}</h2>
                  <p className="section-note">
                    Sent {formatDate(selected.createdAt)} · {timeAgo(selected.createdAt)}
                  </p>
                </div>
                <span className={`ticket-state ticket-state--${selected.status}`}>
                  {STATE_LABEL[selected.status]}
                </span>
              </div>

              <dl className="admin-facts">
                <div>
                  <dt>Reply to</dt>
                  <dd>
                    <a className="textlink" href={`mailto:${selected.email}`}>
                      {selected.email}
                    </a>
                  </dd>
                </div>
                <div>
                  <dt>GoatMedia account</dt>
                  <dd>{selected.reporter ? `@${selected.reporter.username}` : 'Not signed in'}</dd>
                </div>
                <div>
                  <dt>Device</dt>
                  <dd>{selected.device}</dd>
                </div>
                <div>
                  <dt>Page</dt>
                  <dd>
                    {selected.pageUrl ? (
                      /^https?:\/\//.test(selected.pageUrl) ? (
                        <a className="textlink" href={selected.pageUrl} target="_blank" rel="noreferrer">
                          {selected.pageUrl}
                        </a>
                      ) : (
                        selected.pageUrl
                      )
                    ) : (
                      'Not given'
                    )}
                  </dd>
                </div>
              </dl>

              {selected.targetUsername ? (
                <div className="ticket-target">
                  <span className="admin-detail__kind">Account reported</span>
                  {selected.targetAccount ? (
                    <div className="ticket-target__row">
                      <Link className="textlink" to={`/u/${selected.targetAccount.username}`}>
                        @{selected.targetAccount.username}
                        {selected.targetAccount.status === 'deleted'
                          ? ' · removed'
                          : selected.targetAccount.status === 'suspended'
                            ? ' · suspended'
                            : ''}
                      </Link>
                      <button
                        type="button"
                        className="comment__link"
                        onClick={() => onManageAccount(selected.targetAccount!.username)}
                      >
                        Open in control center
                      </button>
                    </div>
                  ) : (
                    <span>@{selected.targetUsername} (no such account)</span>
                  )}
                </div>
              ) : null}

              <p className="ticket-message">{selected.body}</p>

              {selected.resolutionNote ? (
                <p className="report-note">Resolution: {selected.resolutionNote}</p>
              ) : null}

              {actionError ? <p className="field__error">{actionError}</p> : null}

              {selected.status !== 'closed' ? (
                <>
                  {closingOpen ? (
                    <div className="mod-panel">
                      <div className="field">
                        <label className="field__label" htmlFor="ticket-note">
                          Resolution note
                        </label>
                        <textarea
                          id="ticket-note"
                          className="textarea"
                          value={resolutionNote}
                          onChange={(event) => setResolutionNote(event.target.value)}
                          placeholder="What did you do? This is kept for the moderation record, not emailed automatically."
                        />
                      </div>
                      <div className="form-actions">
                        <button
                          type="button"
                          className="btn btn--primary btn--sm"
                          disabled={busy}
                          onClick={() => update('closed')}
                        >
                          {busy ? <span className="btn__spinner" /> : null}
                          Close request
                        </button>
                        <button
                          type="button"
                          className="btn btn--quiet btn--sm"
                          onClick={() => setClosingOpen(false)}
                          disabled={busy}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="admin-actions">
                      {selected.status === 'open' ? (
                        <button
                          type="button"
                          className="btn btn--quiet"
                          disabled={busy}
                          onClick={() => update('reviewing')}
                        >
                          Mark as reviewing
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn btn--primary"
                        disabled={busy}
                        onClick={() => setClosingOpen(true)}
                      >
                        Close request
                      </button>
                    </div>
                  )}
                </>
              ) : null}
            </>
          )}
        </div>
      </div>
    </>
  );
}

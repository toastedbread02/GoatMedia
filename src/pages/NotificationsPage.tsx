import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import type { NotificationDTO } from '../../shared/types';
import { Icon } from '../components/Icon';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { relativeTime } from '../lib/format';

export function NotificationsPage() {
  const { me, refresh } = useAuth();
  const [items, setItems] = useState<NotificationDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    api
      .notifications(true)
      .then((result) => {
        if (cancelled) return;
        setItems(result.notifications);
        void refresh();
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [me, refresh]);

  if (!me) {
    return (
      <div className="column column--reading">
        <div className="empty">
          <Icon name="bell" size={26} />
          <p className="empty__title">Notifications need an account</p>
          <p>Sign in to hear when a post is reviewed or someone comments.</p>
          <Link to="/signin" className="button">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="column column--reading">
      <header className="page-head">
        <h1 className="page-title">Notifications</h1>
        <p className="page-blurb">Review results, new followers and comments on your posts.</p>
      </header>

      {loading ? (
        <p className="feed__loading">Loading…</p>
      ) : error ? (
        <p className="form-error">{error}</p>
      ) : items.length === 0 ? (
        <div className="empty">
          <p className="empty__title">Nothing yet</p>
          <p>When someone follows you or a post is reviewed, it shows up here.</p>
        </div>
      ) : (
        <ul className="notification-list">
          {items.map((item, index) => {
            const href =
              item.type === 'follow' && item.actorUsername
                ? `/u/${item.actorUsername}`
                : item.postId
                  ? `/p/${item.postId}`
                  : '/';
            const icon =
              item.type === 'approved'
                ? 'check'
                : item.type === 'rejected' || item.type === 'removed'
                  ? 'alert'
                  : item.type === 'follow'
                    ? 'users'
                    : 'comment';
            return (
              <li key={item.id} style={{ '--i': Math.min(index, 8) } as CSSProperties}>
                <Link to={href} className={`notification ${item.read ? '' : 'is-unread'}`}>
                  <span className="notification__icon" aria-hidden="true">
                    <Icon name={icon} size={18} />
                  </span>
                  <span className="notification__text">
                    <strong>
                      {item.type === 'approved'
                        ? 'Post approved'
                        : item.type === 'rejected'
                          ? 'Post not approved'
                          : item.type === 'removed'
                            ? 'Post removed'
                            : item.type === 'follow'
                              ? `${item.actorDisplayName || item.actorUsername} followed you`
                              : `${item.actorDisplayName || item.actorUsername} commented`}
                    </strong>
                    {item.detail ? <span className="notification__detail">{item.detail}</span> : null}
                    {item.postCaption ? (
                      <span className="muted notification__caption">{item.postCaption}</span>
                    ) : null}
                  </span>
                  <time dateTime={new Date(item.createdAt).toISOString()}>
                    {relativeTime(item.createdAt)}
                  </time>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

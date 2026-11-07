import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.tsx';
import { api } from '../lib/api.ts';
import { Avatar } from './Avatar.tsx';
import { Icon, type IconName } from './Icon.tsx';
import { Logo } from './Logo.tsx';
import { Popover } from './Popover.tsx';
import { timeAgo } from '../lib/format.ts';
import type { NotificationDTO } from '../../shared/types.ts';

function SearchBox({ autoFocus = false, onSubmitted }: { autoFocus?: boolean; onSubmitted?: () => void }) {
  const [value, setValue] = useState('');
  const navigate = useNavigate();
  return (
    <form
      className="searchbox"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const query = value.trim();
        if (query.length < 2) return;
        navigate(`/search?q=${encodeURIComponent(query)}`);
        setValue('');
        onSubmitted?.();
      }}
    >
      <Icon name="search" size={17} />
      <input
        className="input"
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search goats, people"
        aria-label="Search GoatMedia"
        autoFocus={autoFocus}
      />
    </form>
  );
}

function notificationText(item: NotificationDTO) {
  switch (item.type) {
    case 'approved':
      return 'Your video was approved and is now public';
    case 'rejected':
      return 'Your video needs changes before it can go live';
    case 'removed':
      return 'Your video was removed by the moderator';
    case 'follow':
      return `@${item.actorUsername} started following you`;
    case 'comment':
      return item.isReply
        ? `@${item.actorUsername} replied to your comment`
        : `@${item.actorUsername} commented on your post`;
    case 'like':
      return `@${item.actorUsername} liked your post`;
    case 'new_post':
      return `@${item.actorUsername} posted something new`;
    case 'support':
      return item.actorUsername
        ? `@${item.actorUsername} sent a support request`
        : 'A guest sent a support request';
    case 'milestone':
    case 'weekly':
      return item.detail || 'An update about your goats';
    default:
      return 'New activity';
  }
}

function notificationIcon(type: NotificationDTO['type']): IconName {
  switch (type) {
    case 'approved':
      return 'check';
    case 'rejected':
      return 'alert';
    case 'removed':
      return 'eye-off';
    case 'follow':
      return 'user';
    case 'like':
      return 'heart';
    case 'new_post':
      return 'play';
    case 'support':
      return 'flag';
    case 'milestone':
      return 'spark';
    case 'weekly':
      return 'chart';
    default:
      return 'comment';
  }
}

function NotificationsButton({
  onReadAll,
  onReadOne,
  unreadCount,
}: {
  onReadAll: () => void;
  onReadOne: () => void;
  unreadCount: number;
}) {
  const [items, setItems] = useState<NotificationDTO[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api
      .get<{ items: NotificationDTO[] }>('/api/notifications')
      .then((data) => setItems(data.items))
      .catch(() => setError(true));
  }, []);

  const markRead = async () => {
    if (!items?.some((item) => !item.read)) return;
    setItems((current) => current?.map((item) => ({ ...item, read: true })) ?? null);
    onReadAll();
    try {
      await api.post('/api/notifications/read');
    } catch {
      /* the badge will catch up on the next load */
    }
  };

  const markOneRead = async (item: NotificationDTO) => {
    if (item.read) return;
    setItems((current) => current?.map((entry) => (entry.id === item.id ? { ...entry, read: true } : entry)) ?? null);
    onReadOne();
    try {
      await api.post('/api/notifications/read', { id: item.id });
    } catch {
      /* the badge will catch up on the next load */
    }
  };

  return (
    <Popover
      label="Notifications"
      className="notifications-popover"
      trigger={
        <button
          type="button"
          className="iconbtn"
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        >
          <Icon name="bell" size={20} />
          {unreadCount > 0 ? <span className="iconbtn__dot" aria-hidden="true" /> : null}
        </button>
      }
    >
      {(close) => (
        <div className="notifications">
          <div className="notifications__head">
            <span className="notifications__title">Notifications</span>
            {items?.some((item) => !item.read) ? (
              <button type="button" className="textlink notifications__read" onClick={markRead}>
                Mark all read
              </button>
            ) : null}
          </div>
          {items === null && !error ? (
            <div className="notifications__empty">Loading…</div>
          ) : error ? (
            <div className="notifications__empty">Notifications are unavailable right now.</div>
          ) : (items ?? []).length === 0 ? (
            <div className="notifications__empty">Nothing yet. Post a goat video and the moderator will be in touch.</div>
          ) : (
            <ul className="notifications__list">
              {(items ?? []).map((item) => {
                const to = item.ticketId
                  ? `/admin?tab=reports&view=support&ticket=${item.ticketId}`
                  : item.videoId
                    ? `/v/${item.videoId}`
                    : item.actorUsername
                      ? `/u/${item.actorUsername}`
                      : '/settings';
                return (
                  <li key={item.id}>
                    <Link
                      to={to}
                      className={`notification${item.read ? '' : ' is-unread'}`}
                      onClick={() => {
                        close();
                        void markOneRead(item);
                      }}
                    >
                      <span className="notification__icon">
                        <Icon name={notificationIcon(item.type)} size={16} />
                      </span>
                      <span className="notification__body">
                        <span className="notification__text">{notificationText(item)}</span>
                        {item.detail && item.type !== 'follow' ? (
                          <span className="notification__detail">{item.detail}</span>
                        ) : null}
                        <span className="notification__time">{timeAgo(item.createdAt)}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Popover>
  );
}

function AccountMenu({ onNavigate }: { onNavigate?: () => void }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  if (!user) {
    return (
      <div className="rail__account rail__account--guest">
        <Link className="btn btn--quiet btn--sm" to="/login">
          Sign in
        </Link>
        <Link className="btn btn--ghost btn--sm" to="/contact">
          Contact
        </Link>
      </div>
    );
  }

  return (
    <Popover
      label="Account menu"
      placement="above-start"
      className="account-popover"
      trigger={
        <button type="button" className="rail__account" aria-label="Account menu">
          <Avatar displayName={user.displayName} username={user.username} avatarUrl={user.avatarUrl} size={32} />
          <span className="rail__account-text">
            <span className="rail__account-name">{user.displayName}</span>
            <span className="rail__account-handle">@{user.username}</span>
          </span>
          <Icon name="more" size={18} />
        </button>
      }
    >
      {(close) => (
        <>
          <Link to={`/u/${user.username}`} className="menu-item" onClick={() => { close(); onNavigate?.(); }}>
            <Icon name="user" size={17} /> Your profile
          </Link>
          <Link to="/settings" className="menu-item" onClick={() => { close(); onNavigate?.(); }}>
            <Icon name="settings" size={17} /> Settings
          </Link>
          <Link to="/contact" className="menu-item" onClick={() => { close(); onNavigate?.(); }}>
            <Icon name="flag" size={17} /> Contact the moderator
          </Link>
          {user.role === 'admin' ? (
            <Link to="/admin" className="menu-item" onClick={() => { close(); onNavigate?.(); }}>
              <Icon name="shield" size={17} /> Moderation
            </Link>
          ) : null}
          <div className="menu-sep" />
          <button
            type="button"
            className="menu-item menu-item--danger"
            onClick={async () => {
              close();
              await signOut();
              navigate('/');
            }}
          >
            <Icon name="logout" size={17} /> Sign out
          </button>
        </>
      )}
    </Popover>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  const [unread, setUnread] = useState(user?.unreadNotifications ?? 0);

  useEffect(() => {
    setUnread(user?.unreadNotifications ?? 0);
  }, [user?.id, user?.unreadNotifications]);

  useEffect(() => {
    if (!user) return;
    api
      .get<{ unread: number }>('/api/notifications')
      .then((data) => setUnread(data.unread))
      .catch(() => {});
  }, [user?.id, location.pathname]);

  const clearUnread = useCallback(() => setUnread(0), []);
  const readOne = useCallback(() => setUnread((count) => Math.max(0, count - 1)), []);

  const navItems: { to: string; label: string; icon: IconName; end?: boolean }[] = [
    { to: '/', label: 'For You', icon: 'home', end: true },
    { to: '/trending', label: 'Trending', icon: 'trending' },
    { to: '/following', label: 'Following', icon: 'users' },
  ];

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="rail">
        <div className="rail__top">
          <Logo />
          {user ? (
            <NotificationsButton onReadAll={clearUnread} onReadOne={readOne} unreadCount={unread} />
          ) : null}
        </div>
        <div className="rail__search">
          <SearchBox />
        </div>
        <nav className="rail__nav" aria-label="Main navigation">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `navlink${isActive ? ' is-active' : ''}`}
              title={item.label}
            >
              <Icon name={item.icon} size={20} />
              <span className="navlink__label">{item.label}</span>
            </NavLink>
          ))}
          <NavLink
            to={user ? `/u/${user.username}` : `/login?next=${encodeURIComponent('/')}`}
            className={({ isActive }) => `navlink${isActive ? ' is-active' : ''}`}
            title="Profile"
          >
            <Icon name="user" size={20} />
            <span className="navlink__label">Profile</span>
          </NavLink>
        </nav>
        <div className="rail__spacer" />
        <Link to={user ? '/upload' : '/login?next=/upload'} className="btn btn--primary rail__upload" title="Upload">
          <Icon name="upload" size={19} />
          <span>Upload</span>
        </Link>
        <AccountMenu />
      </aside>

      <div className="content">
        <header className="topbar">
          <Logo />
          <div className="topbar__actions">
            <Link to="/search" className="iconbtn" aria-label="Search">
              <Icon name="search" size={21} />
            </Link>
            <Link to="/contact" className="iconbtn" aria-label="Contact and reports" title="Contact and reports">
              <Icon name="flag" size={20} />
            </Link>
            {user ? <NotificationsButton onReadAll={clearUnread} onReadOne={readOne} unreadCount={unread} /> : null}
            {user ? (
              <Link to={`/u/${user.username}`} className="topbar__avatar" aria-label="Your profile">
                <Avatar displayName={user.displayName} username={user.username} avatarUrl={user.avatarUrl} size={28} />
              </Link>
            ) : (
              <Link to="/login" className="btn btn--quiet btn--sm">
                Sign in
              </Link>
            )}
          </div>
        </header>

        <main id="main" className="main">
          {children}
        </main>

        <nav className="tabbar" aria-label="Mobile navigation">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `tablink${isActive ? ' is-active' : ''}`}
            >
              <span className="tablink__icon">
                <Icon name={item.icon} size={21} />
              </span>
              {item.label}
            </NavLink>
          ))}
          <NavLink to={user ? '/upload' : '/login?next=/upload'} className={({ isActive }) => `tablink${isActive ? ' is-active' : ''}`}>
            <span className="tablink__icon">
              <Icon name="upload" size={21} />
            </span>
            Upload
          </NavLink>
          <NavLink
            to={user ? `/u/${user.username}` : '/login'}
            className={({ isActive }) => `tablink${isActive ? ' is-active' : ''}`}
          >
            <span className="tablink__icon">
              <Icon name="user" size={21} />
            </span>
            Profile
          </NavLink>
        </nav>
      </div>
    </div>
  );
}

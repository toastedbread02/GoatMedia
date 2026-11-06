import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { Avatar } from './Avatar';
import { Icon, type IconName } from './Icon';
import { Menu } from './Menu';

const primary: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'For You', icon: 'home' },
  { to: '/trending', label: 'Trending', icon: 'trending' },
  { to: '/following', label: 'Following', icon: 'users' },
];

export function AppShell() {
  const { me, signOut } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!me) {
      setUnread(0);
      return;
    }
    let cancelled = false;
    api
      .notifications()
      .then((result) => {
        if (!cancelled) setUnread(result.notifications.filter((item) => !item.read).length);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [me, location.pathname]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <header className="topbar">
        <Link to="/" className="topbar__brand" aria-label="GoatMedia home">
          <GoatMark />
          <span>GoatMedia</span>
        </Link>
        <div className="topbar__actions">
          <Link to="/search" className="icon-button" aria-label="Search">
            <Icon name="search" />
          </Link>
          {me ? (
            <Link to="/notifications" className="icon-button topbar__bell" aria-label="Notifications">
              <Icon name="bell" />
              {unread ? <span className="dot" aria-hidden="true" /> : null}
            </Link>
          ) : null}
          {me ? (
            <Link to={`/u/${me.username}`} aria-label="Your profile">
              <Avatar user={me} size={30} />
            </Link>
          ) : (
            <Link to="/signin" className="button button--small">
              Sign in
            </Link>
          )}
        </div>
      </header>

      <nav className="rail" aria-label="Main">
        <Link to="/" className="rail__brand" aria-label="GoatMedia home">
          <GoatMark />
          <span className="wordmark">GoatMedia</span>
        </Link>

        <Link to="/search" className="rail__search">
          <Icon name="search" size={18} />
          <span>Search</span>
        </Link>

        <ul className="rail__list">
          {primary.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => `rail__link ${isActive ? 'is-active' : ''}`}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </NavLink>
            </li>
          ))}
          {me ? (
            <li>
              <NavLink
                to={`/u/${me.username}`}
                className={({ isActive }) => `rail__link ${isActive ? 'is-active' : ''}`}
              >
                <Icon name="user" />
                <span>Profile</span>
              </NavLink>
            </li>
          ) : null}
        </ul>

        <Link to="/upload" className="button rail__upload">
          <Icon name="plus" size={18} />
          <span>New post</span>
        </Link>

        <div className="rail__foot">
          <NavLink to="/guidelines" className="rail__small">
            Community guidelines
          </NavLink>
          <NavLink to="/privacy" className="rail__small">
            Privacy
          </NavLink>
          <NavLink to="/terms" className="rail__small">
            Terms
          </NavLink>

          {me ? (
            <div className="rail__account">
              <Link to={`/u/${me.username}`} className="rail__account-main">
                <Avatar user={me} size={34} />
                <span>
                  <strong>{me.displayName}</strong>
                  <span className="muted">@{me.username}</span>
                </span>
              </Link>
              <Menu
                label="Account menu"
                items={[
                  { label: 'Settings', icon: 'settings', onSelect: () => navigate('/settings') },
                  ...(me.role === 'admin'
                    ? [{ label: 'Moderation', icon: 'shield' as const, onSelect: () => navigate('/admin') }]
                    : []),
                  {
                    label: 'Sign out',
                    icon: 'logout',
                    onSelect: async () => {
                      await signOut();
                      toast('Signed out');
                      navigate('/');
                    },
                  },
                ]}
              />
              {me.role === 'admin' ? (
                <Link to="/admin" className="rail__admin">
                  <Icon name="shield" size={16} />
                  Moderation {me.role === 'admin' ? '' : ''}
                </Link>
              ) : null}
            </div>
          ) : (
            <Link to="/signin" className="button button--quiet rail__signin">
              Sign in
            </Link>
          )}
        </div>
      </nav>

      <main className="main" id="main">
        <Outlet />
      </main>

      <nav className="tabbar" aria-label="Main">
        {primary.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => `tabbar__link ${isActive ? 'is-active' : ''}`}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </NavLink>
        ))}
        <NavLink to="/upload" className={({ isActive }) => `tabbar__link ${isActive ? 'is-active' : ''}`}>
          <Icon name="upload" />
          <span>Post</span>
        </NavLink>
        <NavLink
          to={me ? `/u/${me.username}` : '/signin'}
          className={({ isActive }) => `tabbar__link ${isActive ? 'is-active' : ''}`}
        >
          <Icon name="user" />
          <span>{me ? 'Profile' : 'Sign in'}</span>
        </NavLink>
      </nav>
    </div>
  );
}

export function GoatMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path
        d="M9.2 9.8c-1-2.4-1.4-4.2-1.1-5.6 2.6.5 4.4 1.7 5.4 3.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M22.8 9.8c1-2.4 1.4-4.2 1.1-5.6-2.6.5-4.4 1.7-5.4 3.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M16 7.4c4.3 0 7.4 3.2 7.4 7.6 0 5.4-3.4 9.0-7.4 9.0s-7.4-3.6-7.4-9c0-4.4 3.1-7.6 7.4-7.6z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="M12.4 15.2h.02M19.6 15.2h.02" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M16 19.2v2.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

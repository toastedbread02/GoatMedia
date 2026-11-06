import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { InterestView, PostDTO, PublicUser } from '../../shared/types';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useConfig } from '../lib/config';
import { count, fullDate } from '../lib/format';
import { resizePhoto } from '../lib/image';
import { useToast } from '../lib/toast';

type Tab = 'profile' | 'feed' | 'account';

export function SettingsPage() {
  const { me, loading, setMe, signOut } = useAuth();
  const config = useConfig();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (['profile', 'feed', 'account'].includes(params.get('tab') || '')
    ? params.get('tab')
    : 'profile') as Tab;

  const [displayName, setDisplayName] = useState(me?.displayName || '');
  const [username, setUsername] = useState(me?.username || '');
  const [bio, setBio] = useState(me?.bio || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [interests, setInterests] = useState<InterestView[]>([]);
  const [hidden, setHidden] = useState<PostDTO[]>([]);
  const [blocked, setBlocked] = useState<PublicUser[]>([]);
  const [feedBusy, setFeedBusy] = useState(false);

  useEffect(() => {
    if (!me) return;
    setDisplayName(me.displayName);
    setUsername(me.username);
    setBio(me.bio);
  }, [me]);

  useEffect(() => {
    if (!me || tab !== 'feed') return;
    let cancelled = false;
    Promise.all([api.interests(), api.hidden(), api.blocked()])
      .then(([interestResult, hiddenResult, blockedResult]) => {
        if (cancelled) return;
        setInterests(interestResult.interests);
        setHidden(hiddenResult.items);
        setBlocked(blockedResult.users);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [me, tab]);

  if (loading) return <div className="column" aria-busy="true" />;

  if (!me) {
    return (
      <div className="column column--reading">
        <div className="empty">
          <p className="empty__title">Settings need an account</p>
          <p>Sign in to change your profile, avatar or recommendations.</p>
          <Link to="/signin" className="button">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const saveProfile = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await api.updateProfile({ displayName, username, bio });
      setMe(result.user);
      toast('Profile saved', 'success');
      if (result.user.username !== me.username) navigate(`/u/${result.user.username}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const changeAvatar = async (file: File | null) => {
    if (!file) return;
    try {
      const blob = await resizePhoto(file, { maxDimension: 600, maxBytes: 380_000 });
      const result = await api.uploadAvatar(blob);
      setMe(result.user);
      toast('Profile photo updated', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <div className="column column--reading">
      <header className="page-head">
        <h1 className="page-title">Settings</h1>
        <p className="page-blurb">Your profile, your recommendations, your account.</p>
      </header>

      <div className="segmented" role="tablist" aria-label="Settings sections">
        {(
          [
            ['profile', 'Profile'],
            ['feed', 'Feed'],
            ['account', 'Account'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? 'is-active' : ''}
            onClick={() => setParams({ tab: value })}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'profile' ? (
        <section className="settings-section" aria-label="Profile">
          <div className="avatar-edit">
            <Avatar user={me} size={76} />
            <div className="avatar-edit__actions">
              <label className="button button--quiet">
                Change photo
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="visually-hidden"
                  onChange={(event) => changeAvatar(event.target.files?.[0] || null)}
                />
              </label>
              {me.avatarUrl ? (
                <button
                  type="button"
                  className="text-button"
                  onClick={async () => {
                    const result = await api.deleteAvatar();
                    setMe(result.user);
                    toast('Profile photo removed');
                  }}
                >
                  Remove
                </button>
              ) : null}
            </div>
            <p className="hint">Square-ish photos look best. Resized to 600 px before upload.</p>
          </div>

          <label className="field">
            <span className="field__label">Display name</span>
            <input
              className="input"
              value={displayName}
              maxLength={40}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field__label">Username</span>
            <input
              className="input"
              value={username}
              maxLength={20}
              onChange={(event) => setUsername(event.target.value.toLowerCase())}
            />
            <span className="field__hint">
              Changing this changes your profile link. Old links will stop working.
            </span>
          </label>
          <label className="field">
            <span className="field__label">Bio</span>
            <textarea
              className="textarea"
              rows={3}
              maxLength={config.limits.maxBioLength}
              value={bio}
              onChange={(event) => setBio(event.target.value)}
              placeholder="A sentence about you and your goats."
            />
            <span className="field__hint">
              {bio.length}/{config.limits.maxBioLength}
            </span>
          </label>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="button" className="button" onClick={saveProfile} disabled={saving}>
            {saving ? 'Saving…' : 'Save profile'}
          </button>
        </section>
      ) : null}

      {tab === 'feed' ? (
        <section className="settings-section" aria-label="Feed">
          <h2 className="settings-title">What your feed has learned</h2>
          <p className="aside-text">
            Every like, comment, follow, completed post and skip adjusts these numbers. They fade
            over time, so a phase of baby-goat posts does not define you forever.
          </p>

          {interests.length === 0 ? (
            <p className="hint">Nothing learned yet. Watch, like or skip a few posts.</p>
          ) : (
            <ul className="interest-list">
              {interests.map((interest) => (
                <li key={`${interest.kind}-${interest.value}`}>
                  <span className="interest-list__name">
                    {interest.kind === 'hashtag' ? `#${interest.value}` : interest.value.replace(/-/g, ' ')}
                  </span>
                  <span className={`interest-list__value ${interest.weight < 0 ? 'is-negative' : ''}`}>
                    {interest.weight > 0 ? '+' : ''}
                    {interest.weight}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="settings-actions">
            <button
              type="button"
              className="button button--quiet"
              disabled={feedBusy}
              onClick={async () => {
                setFeedBusy(true);
                try {
                  await api.resetInterests();
                  setInterests([]);
                  setHidden([]);
                  toast('Recommendations reset');
                } catch (err) {
                  toast((err as Error).message, 'error');
                } finally {
                  setFeedBusy(false);
                }
              }}
            >
              Reset recommendations
            </button>
          </div>

          <h2 className="settings-title">Posts you hid</h2>
          {hidden.length === 0 ? (
            <p className="hint">None. “Not interested” hides a post from your feed.</p>
          ) : (
            <ul className="mini-grid">
              {hidden.map((post) => (
                <li key={post.id}>
                  <div className="mini-grid__item">
                    {post.photos[0] ? <img src={post.photos[0].url} alt="" loading="lazy" /> : null}
                    <button
                      type="button"
                      className="mini-grid__action"
                      onClick={async () => {
                        await api.notInterested(post.id, false);
                        setHidden((current) => current.filter((item) => item.id !== post.id));
                        toast('Post will appear again');
                      }}
                    >
                      Show again
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <h2 className="settings-title">Blocked accounts</h2>
          {blocked.length === 0 ? (
            <p className="hint">You have not blocked anyone.</p>
          ) : (
            <ul className="creator-list">
              {blocked.map((user) => (
                <li key={user.id}>
                  <div className="creator-row creator-row--static">
                    <Avatar user={user} size={38} />
                    <span className="creator-row__text">
                      <strong>{user.displayName}</strong>
                      <span className="muted">@{user.username}</span>
                    </span>
                    <button
                      type="button"
                      className="button button--quiet button--small"
                      onClick={async () => {
                        await api.block(user.username, false);
                        setBlocked((current) => current.filter((item) => item.id !== user.id));
                        toast('Unblocked');
                      }}
                    >
                      Unblock
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === 'account' ? (
        <section className="settings-section" aria-label="Account">
          <dl className="fact-list">
            <div>
              <dt>Email</dt>
              <dd>{me.email}</dd>
            </div>
            <div>
              <dt>Username</dt>
              <dd>@{me.username}</dd>
            </div>
            <div>
              <dt>Joined</dt>
              <dd>{fullDate(me.createdAt)}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{me.role === 'admin' ? 'Moderator' : 'Member'}</dd>
            </div>
            <div>
              <dt>Posts</dt>
              <dd>{count(me.postCount)} approved</dd>
            </div>
          </dl>

          <div className="settings-actions">
            {me.role === 'admin' ? (
              <Link to="/admin" className="button button--quiet">
                <Icon name="shield" size={17} />
                Moderation dashboard
              </Link>
            ) : null}
            <button
              type="button"
              className="button button--quiet"
              onClick={async () => {
                await signOut();
                toast('Signed out');
                navigate('/');
              }}
            >
              <Icon name="logout" size={17} />
              Sign out
            </button>
          </div>

          <h2 className="settings-title">Deleting your account</h2>
          <p className="aside-text">
            There is no self-service deletion yet. Ask the moderator and it will be removed along
            with your posts, photos and audio. You can delete individual posts from the post menu in
            the meantime.
          </p>
        </section>
      ) : null}
    </div>
  );
}

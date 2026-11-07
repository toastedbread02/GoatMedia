import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { InterestView, MeDTO, PublicUser, VideoDTO } from '../../shared/types.ts';
import { api, ApiError, uploadWithProgress } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useConfig } from '../lib/config.tsx';
import { useToast } from '../lib/toast.tsx';
import { useDocumentTitle } from '../lib/hooks.ts';
import { compactNumber, formatDate } from '../lib/format.ts';
import { useTheme, type MotionChoice, type ThemeChoice } from '../lib/theme.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { Icon } from '../components/Icon.tsx';
import { SettingsSkeleton, Skeleton } from '../components/Skeleton.tsx';

function ageOnDate(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const born = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(born.getTime())) return null;
  const today = new Date();
  let age = today.getUTCFullYear() - born.getUTCFullYear();
  const month = today.getUTCMonth() - born.getUTCMonth();
  if (month < 0 || (month === 0 && today.getUTCDate() < born.getUTCDate())) age -= 1;
  return age;
}

function SettingToggle({
  title,
  description,
  checked,
  onChange,
  busy,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  busy?: boolean;
}) {
  return (
    <div className="setting-toggle">
      <div className="setting-toggle__text">
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        className="switch"
        onClick={() => onChange(!checked)}
        disabled={busy}
      />
    </div>
  );
}

function useUsernameCheck(username: string, current: string) {
  const [state, setState] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle');
  useEffect(() => {
    const value = username.trim().toLowerCase();
    if (!value || value === current) {
      setState('idle');
      return;
    }
    if (!/^[a-z0-9_]{3,20}$/.test(value)) {
      setState('invalid');
      return;
    }
    setState('checking');
    const timer = setTimeout(() => {
      api
        .get<{ available: boolean }>(`/api/usernames/${encodeURIComponent(value)}/available`)
        .then((data) => setState(data.available ? 'available' : 'taken'))
        .catch(() => setState('idle'));
    }, 350);
    return () => clearTimeout(timer);
  }, [username, current]);
  return state;
}

export function SettingsPage() {
  useDocumentTitle('Settings');
  const { user, loading, setUser, signOut, refresh } = useAuth();
  const config = useConfig();
  const { notify } = useToast();
  const navigate = useNavigate();
  const avatarInput = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [profileFields, setProfileFields] = useState<Record<string, string>>({});
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  const [interests, setInterests] = useState<InterestView[] | null>(null);
  const [hidden, setHidden] = useState<VideoDTO[] | null>(null);
  const [blocked, setBlocked] = useState<PublicUser[] | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);

  const { theme, setTheme, motion, setMotion } = useTheme();
  const [birthDate, setBirthDate] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);
  const [hideFollows, setHideFollows] = useState(false);
  const [searchable, setSearchable] = useState(true);
  const [savingPrivacy, setSavingPrivacy] = useState(false);

  const usernameState = useUsernameCheck(username, user?.username ?? '');

  useEffect(() => {
    if (!user) return;
    setDisplayName(user.displayName);
    setUsername(user.username);
    setBio(user.bio);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    setBirthDate(user.birthDate ?? '');
    setHideFollows(Boolean(user.hideFollows));
    setSearchable(user.searchable !== false);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    api.get<{ items: InterestView[] }>('/api/me/interests').then((data) => setInterests(data.items)).catch(() => {});
    api.get<{ items: VideoDTO[] }>('/api/me/hidden').then((data) => setHidden(data.items)).catch(() => {});
    api.get<{ items: PublicUser[] }>('/api/me/blocked').then((data) => setBlocked(data.items)).catch(() => {});
  }, [user]);

  if (loading) return <SettingsSkeleton />;

  if (!user) {
    return (
      <div className="page">
        <div className="empty-state" style={{ paddingTop: 48 }}>
          <Icon name="settings" size={26} />
          <h2>Sign in to manage your account</h2>
          <Link className="btn btn--primary" to="/login?next=/settings">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const savePrivacy = async (patch: { hideFollows?: boolean; searchable?: boolean }) => {
    const before = { hideFollows, searchable };
    const next = { hideFollows, searchable, ...patch };
    setHideFollows(next.hideFollows);
    setSearchable(next.searchable);
    setSavingPrivacy(true);
    try {
      await api.patch('/api/me', next);
      setUser({ ...user, ...next });
      notify('Privacy updated.');
    } catch (error) {
      setHideFollows(before.hideFollows);
      setSearchable(before.searchable);
      notify(error instanceof Error ? error.message : 'That setting did not save.', { tone: 'error' });
    } finally {
      setSavingPrivacy(false);
    }
  };

  const age = ageOnDate(birthDate);

  const uploadAvatar = async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      notify('Use a JPEG, PNG or WEBP photo.', { tone: 'error' });
      return;
    }
    if (file.size > (config?.limits.maxAvatarMb ?? 4) * 1024 * 1024) {
      notify(`Keep the photo under ${config?.limits.maxAvatarMb ?? 4} MB.`, { tone: 'error' });
      return;
    }
    setAvatarBusy(true);
    const form = new FormData();
    form.append('avatar', file);
    try {
      const data = await uploadWithProgress<{ user: MeDTO }>('/api/me/avatar', form, () => {});
      setUser(data.user);
      notify('New photo saved.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'The photo did not upload.', { tone: 'error' });
    } finally {
      setAvatarBusy(false);
      if (avatarInput.current) avatarInput.current.value = '';
    }
  };

  return (
    <div className="page settings-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">Your profile, privacy, appearance and what the feed has learned.</p>
        </div>
        <Link className="btn btn--quiet btn--sm" to={`/u/${user.username}`}>
          View profile
        </Link>
      </div>

      <section className="settings-section" aria-labelledby="settings-profile">
        <div className="settings-section__intro">
          <h2 id="settings-profile">Profile</h2>
          <p>This is what people see on your profile and under your videos.</p>
        </div>
        <div className="settings-section__body">
          <div className="avatar-row">
            <Avatar
              displayName={user.displayName}
              username={user.username}
              avatarUrl={user.avatarUrl}
              size={68}
            />
            <div className="avatar-row__actions">
              <button
                type="button"
                className="btn btn--quiet btn--sm"
                onClick={() => avatarInput.current?.click()}
                disabled={avatarBusy}
              >
                {avatarBusy ? <span className="btn__spinner" /> : <Icon name="camera" size={16} />}
                {avatarBusy ? 'Saving…' : 'Change photo'}
              </button>
              {user.avatarUrl ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={async () => {
                    const data = await api.delete<{ user: MeDTO }>('/api/me/avatar');
                    setUser(data.user);
                    notify('Photo removed.');
                  }}
                >
                  Remove
                </button>
              ) : null}
              <span className="field__hint">JPEG, PNG or WEBP · square works best.</span>
            </div>
            <input
              ref={avatarInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="visually-hidden"
              aria-label="Choose profile photo"
              onChange={(event) => uploadAvatar(event.target.files?.[0])}
            />
          </div>

          <form
            className="form-stack"
            onSubmit={async (event) => {
              event.preventDefault();
              setSavingProfile(true);
              setProfileFields({});
              try {
                const data = await api.patch<{ user: MeDTO; message: string }>('/api/me', {
                  displayName,
                  username,
                  bio,
                });
                setUser(data.user);
                notify(data.message);
                if (data.user.username !== user.username) navigate(`/u/${data.user.username}`);
              } catch (error) {
                if (error instanceof ApiError) setProfileFields(error.fields ?? {});
                notify(error instanceof Error ? error.message : 'Could not save the profile.', { tone: 'error' });
              } finally {
                setSavingProfile(false);
              }
            }}
          >
            <div className="form-row">
              <div className="field">
                <label className="field__label" htmlFor="displayName">
                  Display name
                </label>
                <input
                  id="displayName"
                  className="input"
                  value={displayName}
                  maxLength={40}
                  onChange={(event) => setDisplayName(event.target.value)}
                  aria-invalid={Boolean(profileFields.displayName)}
                />
                {profileFields.displayName ? <span className="field__error">{profileFields.displayName}</span> : null}
              </div>
              <div className="field">
                <label className="field__label" htmlFor="username">
                  Username
                </label>
                <input
                  id="username"
                  className="input"
                  value={username}
                  maxLength={20}
                  onChange={(event) => setUsername(event.target.value.toLowerCase())}
                  aria-invalid={Boolean(profileFields.username) || usernameState === 'taken'}
                  aria-describedby="username-state"
                />
                <span className="field__hint" id="username-state">
                  {usernameState === 'checking'
                    ? 'Checking…'
                    : usernameState === 'taken'
                      ? 'That username is taken.'
                      : usernameState === 'available'
                        ? 'Available.'
                        : usernameState === 'invalid'
                          ? 'Letters, numbers and underscores only.'
                          : 'Changing this changes your profile link.'}
                </span>
                {profileFields.username ? <span className="field__error">{profileFields.username}</span> : null}
              </div>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="bio">
                Bio
              </label>
              <textarea
                id="bio"
                className="textarea"
                value={bio}
                maxLength={200}
                onChange={(event) => setBio(event.target.value)}
                placeholder="A sentence about you and your goats."
              />
              <span className="field__hint">{bio.length}/200 · Shown publicly.</span>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn--primary" disabled={savingProfile}>
                {savingProfile ? <span className="btn__spinner" /> : null}
                Save profile
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="settings-account">
        <div className="settings-section__intro">
          <h2 id="settings-appearance">Appearance</h2>
          <p>Choose how GoatMedia looks. This device remembers your choice.</p>
        </div>
        <div className="settings-section__body">
          <div className="field">
            <span className="field__label">Theme</span>
            <div className="choice-row">
              <div className="choice-group" role="group" aria-label="Theme">
                {(
                  [
                    { id: 'system', label: 'System' },
                    { id: 'light', label: 'Light' },
                    { id: 'dark', label: 'Dark' },
                  ] as { id: ThemeChoice; label: string }[]
                ).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className="choice"
                    aria-pressed={theme === option.id}
                    onClick={() => setTheme(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <span className="field__hint">
              System follows the light or dark setting on your device.
            </span>
          </div>
          <div className="field">
            <span className="field__label">Motion</span>
            <div className="choice-row">
              <div className="choice-group" role="group" aria-label="Motion">
                {(
                  [
                    { id: 'system', label: 'Full' },
                    { id: 'reduced', label: 'Reduced' },
                  ] as { id: MotionChoice; label: string }[]
                ).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className="choice"
                    aria-pressed={motion === option.id}
                    onClick={() => setMotion(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <span className="field__hint">
              Reduced turns off decorative transitions and skeleton shimmer. Video playback is unchanged.
            </span>
          </div>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="settings-privacy">
        <div className="settings-section__intro">
          <h2 id="settings-privacy">Privacy</h2>
          <p>Your email, date of birth and sign-in details are never public.</p>
        </div>
        <div className="settings-section__body">
          <SettingToggle
            title="Keep my follower lists private"
            description="People can still see your follower count, but not who follows you or who you follow. Only you can open those lists."
            checked={hideFollows}
            busy={savingPrivacy}
            onChange={(next) => void savePrivacy({ hideFollows: next })}
          />
          <SettingToggle
            title="Show my profile in search"
            description="When off, your username and name stop appearing in people search. Your posts can still be found by caption and tags."
            checked={searchable}
            busy={savingPrivacy}
            onChange={(next) => void savePrivacy({ searchable: next })}
          />
          <p className="section-note">
            Blocking an account still hides its posts from your feed and stops it following you.
          </p>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="settings-account">
        <div className="settings-section__intro">
          <h2 id="settings-account">Account</h2>
          <p>Sign-in details are never shown on your public profile.</p>
        </div>
        <div className="settings-section__body">
          <div className="settings-line">
            <span className="field__label">Email</span>
            <span>{user.email}</span>
            <span className="field__hint">Used for sign-in and password recovery.</span>
          </div>
          <div className="settings-line">
            <span className="field__label">Role</span>
            <span>{user.role === 'admin' ? 'Moderator' : 'Member'}</span>
            {user.role === 'admin' ? (
              <Link className="textlink" to="/admin">
                Open moderation
              </Link>
            ) : null}
          </div>
          <div className="settings-line">
            <span className="field__label">Joined</span>
            <span>{formatDate(user.createdAt)}</span>
          </div>

          <form
            className="form-stack"
            onSubmit={async (event) => {
              event.preventDefault();
              setSavingDetails(true);
              try {
                const data = await api.patch<{ user: MeDTO }>('/api/me', { birthDate });
                setUser(data.user);
                notify('Date of birth saved.');
              } catch (error) {
                notify(error instanceof Error ? error.message : 'Could not save that date.', { tone: 'error' });
              } finally {
                setSavingDetails(false);
              }
            }}
          >
            <h3>Date of birth</h3>
            <div className="field" style={{ maxWidth: 260 }}>
              <label className="field__label" htmlFor="birth-date">
                Date of birth
              </label>
              <input
                id="birth-date"
                className="input"
                type="date"
                value={birthDate}
                max={new Date().toISOString().slice(0, 10)}
                min="1900-01-01"
                onChange={(event) => setBirthDate(event.target.value)}
                required
              />
              <span className="field__hint">
                {age !== null ? `${age} years old · ` : ''}
                Private. Used to keep the community adults-and-teens only and never shown on your profile.
              </span>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn--quiet btn--sm" disabled={savingDetails}>
                {savingDetails ? <span className="btn__spinner" /> : null}
                Save date
              </button>
            </div>
          </form>

          <form
            className="form-stack"
            onSubmit={async (event) => {
              event.preventDefault();
              setPasswordError(null);
              if (newPassword !== confirmPassword) {
                setPasswordError('The new passwords do not match.');
                return;
              }
              setSavingPassword(true);
              try {
                await api.post('/api/auth/password/change', { currentPassword, newPassword });
                setCurrentPassword('');
                setNewPassword('');
                setConfirmPassword('');
                notify('Password updated.');
                await refresh();
              } catch (error) {
                setPasswordError(error instanceof Error ? error.message : 'Could not change the password.');
              } finally {
                setSavingPassword(false);
              }
            }}
          >
            <h3>Change password</h3>
            <div className="form-row">
              <div className="field">
                <label className="field__label" htmlFor="current-password">
                  Current password
                </label>
                <input
                  id="current-password"
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="new-password-settings">
                  New password
                </label>
                <input
                  id="new-password-settings"
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                />
              </div>
            </div>
            <div className="field" style={{ maxWidth: 320 }}>
              <label className="field__label" htmlFor="confirm-new-password">
                Repeat new password
              </label>
              <input
                id="confirm-new-password"
                className="input"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
            </div>
            {passwordError ? <p className="field__error">{passwordError}</p> : null}
            <div className="form-actions">
              <button type="submit" className="btn btn--primary" disabled={savingPassword}>
                {savingPassword ? <span className="btn__spinner" /> : null}
                Update password
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={async () => {
                  await signOut();
                  navigate('/');
                }}
              >
                <Icon name="logout" size={17} /> Sign out
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="settings-feed">
        <div className="settings-section__intro">
          <h2 id="settings-feed">Your feed</h2>
          <p>GoatMedia starts with simple, explainable signals. This is what yours look like.</p>
        </div>
        <div className="settings-section__body">
          {interests === null ? (
            <div className="settings-skel" aria-hidden="true">
              <Skeleton className="sk--line" style={{ width: '46%' }} />
              <Skeleton className="sk--line" style={{ width: '72%' }} />
              <Skeleton className="sk--line" style={{ width: '58%' }} />
            </div>
          ) : interests.length === 0 ? (
            <p className="section-note">
              Nothing learned yet. Watch a few videos, like something, or follow a creator and this will fill in.
            </p>
          ) : (
            <div className="interest-groups">
              <div>
                <h3 className="interest-group__title">More of</h3>
                {interests.filter((item) => item.weight > 0).length === 0 ? (
                  <p className="section-note">Nothing yet.</p>
                ) : (
                  <ul className="interest-list">
                    {interests
                      .filter((item) => item.weight > 0)
                      .map((item) => (
                        <li key={`${item.kind}-${item.value}`}>
                          <span>{item.value}</span>
                          <span className="interest-weight">+{item.weight}</span>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
              <div>
                <h3 className="interest-group__title">Less of</h3>
                {interests.filter((item) => item.weight < 0).length === 0 ? (
                  <p className="section-note">Nothing yet. Swiping past a video quickly counts.</p>
                ) : (
                  <ul className="interest-list">
                    {interests
                      .filter((item) => item.weight < 0)
                      .map((item) => (
                        <li key={`${item.kind}-${item.value}`}>
                          <span>{item.value}</span>
                          <span className="interest-weight">{item.weight}</span>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          <div className="settings-actions">
            {confirmReset ? (
              <div className="inline-confirm">
                <p>Clear everything the feed has learned? Your likes, follows and hidden videos stay as they are.</p>
                <div className="form-actions">
                  <button
                    type="button"
                    className="btn btn--danger btn--sm"
                    onClick={async () => {
                      try {
                        await api.post('/api/me/reset-interests');
                        setInterests([]);
                        setConfirmReset(false);
                        notify('Recommendations reset.');
                      } catch {
                        notify('Could not reset recommendations.', { tone: 'error' });
                      }
                    }}
                  >
                    Reset recommendations
                  </button>
                  <button type="button" className="btn btn--quiet btn--sm" onClick={() => setConfirmReset(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="btn btn--quiet btn--sm"
                onClick={() => setConfirmReset(true)}
                disabled={!interests?.length}
              >
                Reset recommendations
              </button>
            )}
          </div>

          <div className="settings-subsection">
            <h3>Hidden videos</h3>
            {hidden === null ? (
              <div className="settings-skel" aria-hidden="true">
                <Skeleton className="sk--line" style={{ width: '64%' }} />
                <Skeleton className="sk--line" style={{ width: '48%' }} />
              </div>
            ) : hidden.length === 0 ? (
              <p className="section-note">Videos you mark as not interested will be listed here so you can undo it.</p>
            ) : (
              <ul className="mini-list">
                {hidden.map((video) => (
                  <li key={video.id} className="mini-video">
                    <div className="mini-video__thumb">
                      {video.posterUrl ? <img src={video.posterUrl} alt="" loading="lazy" /> : null}
                    </div>
                    <div className="mini-video__body">
                      <Link to={`/v/${video.id}`}>{video.caption}</Link>
                      <span className="field__hint">
                        {video.creator.displayName} · {compactNumber(video.viewCount)} views
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn btn--quiet btn--sm"
                      onClick={async () => {
                        try {
                          await api.delete(`/api/me/hidden/${video.id}`);
                          setHidden((items) => (items ?? []).filter((item) => item.id !== video.id));
                          notify('That video can appear in your feed again.');
                        } catch {
                          notify('Could not undo that.', { tone: 'error' });
                        }
                      }}
                    >
                      Show again
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="settings-subsection">
            <h3>Blocked accounts</h3>
            {blocked === null ? (
              <div className="settings-skel" aria-hidden="true">
                <Skeleton className="sk--line" style={{ width: '56%' }} />
                <Skeleton className="sk--line" style={{ width: '40%' }} />
              </div>
            ) : blocked.length === 0 ? (
              <p className="section-note">No one is blocked. You can block someone from their profile.</p>
            ) : (
              <ul className="mini-list">
                {blocked.map((person) => (
                  <li key={person.id} className="mini-video">
                    <Link to={`/u/${person.username}`}>
                      <Avatar displayName={person.displayName} username={person.username} avatarUrl={person.avatarUrl} size={36} />
                    </Link>
                    <div className="mini-video__body">
                      <Link to={`/u/${person.username}`}>{person.displayName}</Link>
                      <span className="field__hint">@{person.username}</span>
                    </div>
                    <button
                      type="button"
                      className="btn btn--quiet btn--sm"
                      onClick={async () => {
                        try {
                          await api.delete(`/api/users/${person.username}/block`);
                          setBlocked((items) => (items ?? []).filter((item) => item.id !== person.id));
                          notify(`Unblocked @${person.username}.`);
                        } catch {
                          notify('Could not unblock that account.', { tone: 'error' });
                        }
                      }}
                    >
                      Unblock
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="section-note">
            Read the <Link className="textlink" to="/guidelines">community guidelines</Link>, the{' '}
            <Link className="textlink" to="/privacy">privacy page</Link> or the{' '}
            <Link className="textlink" to="/terms">terms</Link>. What this site keeps in your browser is listed
            under <Link className="textlink" to="/cookies">cookies and storage</Link>.
          </p>
        </div>
      </section>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { PostDTO, SoundLibraryItem } from '../../shared/types';
import { Icon } from '../components/Icon';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useConfig } from '../lib/config';
import { duration, plural } from '../lib/format';
import { resizePhoto } from '../lib/image';
import { useToast } from '../lib/toast';

interface Prepared {
  id: string;
  blob: Blob;
  url: string;
  name: string;
  size: number;
}

async function preparePhoto(file: File, maxBytes: number): Promise<Prepared> {
  try {
    const blob = await resizePhoto(file, { maxBytes });
    return {
      id: crypto.randomUUID(),
      blob,
      url: URL.createObjectURL(blob),
      name: file.name.replace(/\.[^.]+$/, ''),
      size: blob.size,
    };
  } catch (error) {
    throw new Error(`${file.name}: ${(error as Error).message}`);
  }
}

export function UploadPage() {
  const { me, loading: authLoading } = useAuth();
  const config = useConfig();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const presetSound = params.get('sound');

  const [photos, setPhotos] = useState<Prepared[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [caption, setCaption] = useState('');
  const [category, setCategory] = useState(config.categories[0]?.id || '');
  const [soundMode, setSoundMode] = useState<'none' | 'library' | 'upload'>('none');
  const [library, setLibrary] = useState<SoundLibraryItem[]>([]);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [selectedSound, setSelectedSound] = useState<SoundLibraryItem | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [soundTitle, setSoundTitle] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<PostDTO | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const audioInput = useRef<HTMLInputElement | null>(null);

  const maxBytes = config.limits.maxPhotoMb * 1024 * 1024;
  const audioPreview = useMemo(() => (audioFile ? URL.createObjectURL(audioFile) : ''), [audioFile]);

  useEffect(() => {
    if (soundMode !== 'library') return;
    let cancelled = false;
    api
      .sounds(libraryQuery, 1)
      .then((result) => {
        if (cancelled) return;
        setLibrary(result.sounds);
        if (presetSound && !selectedSound) {
          const found = result.sounds.find((sound) => sound.id === presetSound);
          if (found) setSelectedSound(found);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [soundMode, libraryQuery, presetSound, selectedSound]);

  useEffect(() => {
    if (presetSound) setSoundMode('library');
  }, [presetSound]);

  const hashtags = useMemo(() => {
    const found = caption.match(/#([a-z0-9_]{2,24})/gi) || [];
    return [...new Set(found.map((tag) => tag.slice(1).toLowerCase()))].slice(0, 8);
  }, [caption]);

  const addFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    setError(null);
    const room = config.limits.maxPhotos - photos.length;
    if (files.length > room) {
      setError(`You can add ${plural(room, 'more photo', 'more photos')} to this post.`);
    }
    setPreparing(true);
    const next: Prepared[] = [];
    for (const file of files.slice(0, room)) {
      try {
        next.push(await preparePhoto(file, maxBytes));
      } catch (err) {
        setError((err as Error).message);
      }
    }
    setPreparing(false);
    setPhotos((current) => [...current, ...next]);
  };

  const move = (index: number, direction: -1 | 1) => {
    setPhotos((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const chooseAudio = (file: File | null) => {
    if (!file) {
      setAudioFile(null);
      setAudioDuration(0);
      return;
    }
    if (file.size > config.limits.maxAudioMb * 1024 * 1024) {
      setError(`Audio files are limited to ${config.limits.maxAudioMb} MB.`);
      return;
    }
    setAudioFile(file);
    if (!soundTitle) setSoundTitle(file.name.replace(/\.[^.]+$/, '').slice(0, 60));
    const probe = new Audio(URL.createObjectURL(file));
    probe.onloadedmetadata = () => {
      setAudioDuration(Math.round((probe.duration || 0) * 1000));
      URL.revokeObjectURL(probe.src);
    };
  };

  const ready =
    photos.length > 0 &&
    Boolean(category) &&
    (soundMode !== 'library' || Boolean(selectedSound)) &&
    (soundMode !== 'upload' || Boolean(audioFile));

  const submit = async () => {
    if (!ready || progress !== null) return;
    setError(null);
    setProgress(0);
    const form = new FormData();
    photos.forEach((photo) => form.append('photos', photo.blob, `${photo.name || 'photo'}.jpg`));
    form.append('caption', caption.trim());
    form.append('category', category);
    form.append('soundMode', soundMode);
    if (soundMode === 'library' && selectedSound) {
      form.append('soundId', selectedSound.id);
    }
    if (soundMode === 'upload' && audioFile) {
      form.append('audio', audioFile);
      form.append('audioDurationMs', String(audioDuration));
      form.append('soundTitle', soundTitle.slice(0, 60));
    }
    try {
      const result = await api.createPost(form, setProgress);
      setCreated(result.post);
      photos.forEach((photo) => URL.revokeObjectURL(photo.url));
      setPhotos([]);
      toast('Sent for review', 'success');
    } catch (err) {
      setError((err as Error).message);
      setProgress(null);
    }
  };

  if (authLoading) {
    return (
      <div className="column">
        <div className="post-skeleton" aria-busy="true">
          <div className="post-skeleton__media" />
        </div>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="column column--reading">
        <div className="empty">
          <Icon name="upload" size={26} />
          <p className="empty__title">Sign in to post a goat</p>
          <p>You need an account so the moderator knows who to credit, and who to ask about a post.</p>
          <div className="empty__actions">
            <Link to="/signin" className="button">
              Sign in
            </Link>
            <Link to="/register" className="button button--quiet">
              Create an account
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (created) {
    return (
      <div className="column column--reading">
        <div className="sent">
          <span className="sent__icon" aria-hidden="true">
            <Icon name="check" size={24} />
          </span>
          <h1 className="page-title">Sent for review</h1>
          <p className="page-blurb">
            A person watches and checks every post before it goes live. Yours is in the queue now, so
            it is visible to you and the moderator only.
          </p>
          <ul className="sent__meta">
            <li>
              <span className="muted">Photos</span>
              {created.photos.length}
            </li>
            <li>
              <span className="muted">Category</span>
              {created.categoryLabel}
            </li>
            <li>
              <span className="muted">Sound</span>
              {created.sound ? created.sound.title : 'None'}
            </li>
          </ul>
          <div className="sent__actions">
            <Link to={`/p/${created.id}`} className="button">
              View your post
            </Link>
            <Link to={`/u/${me.username}`} className="button button--quiet">
              Go to profile
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="layout layout--upload">
      <div className="column">
        <header className="page-head">
          <h1 className="page-title">New post</h1>
          <p className="page-blurb">
            Photos of goats, in order. Swipe through them later like a small album.
          </p>
        </header>

        <section className="form-section" aria-labelledby="photos-heading">
          <div className="form-section__head">
            <h2 id="photos-heading">Photos</h2>
            <span className="muted">
              {photos.length}/{config.limits.maxPhotos}
            </span>
          </div>

          {photos.length ? (
            <ul className="thumbs">
              {photos.map((photo, index) => (
                <li key={photo.id} style={{ '--i': index } as CSSProperties} className="thumb">
                  <img src={photo.url} alt={`Photo ${index + 1}`} />
                  <div className="thumb__tools">
                    <button
                      type="button"
                      className="thumb__move"
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      aria-label={`Move photo ${index + 1} earlier`}
                    >
                      <Icon name="chevron-left" size={16} />
                    </button>
                    <span className="thumb__index">{index + 1}</span>
                    <button
                      type="button"
                      className="thumb__move"
                      onClick={() => move(index, 1)}
                      disabled={index === photos.length - 1}
                      aria-label={`Move photo ${index + 1} later`}
                    >
                      <Icon name="chevron-right" size={16} />
                    </button>
                    <button
                      type="button"
                      className="thumb__remove"
                      onClick={() => {
                        URL.revokeObjectURL(photo.url);
                        setPhotos((current) => current.filter((item) => item.id !== photo.id));
                      }}
                      aria-label={`Remove photo ${index + 1}`}
                    >
                      <Icon name="close" size={15} />
                    </button>
                  </div>
                </li>
              ))}
              {photos.length < config.limits.maxPhotos ? (
                <li className="thumb thumb--add">
                  <button type="button" onClick={() => fileInput.current?.click()}>
                    <Icon name="plus" size={20} />
                    Add more
                  </button>
                </li>
              ) : null}
            </ul>
          ) : (
            <button
              type="button"
              className="dropzone"
              onClick={() => fileInput.current?.click()}
              disabled={preparing}
            >
              <Icon name="upload" size={22} />
              <strong>{preparing ? 'Preparing photos…' : 'Choose photos'}</strong>
              <span>JPEG, PNG or WebP. Up to {config.limits.maxPhotos} per post.</span>
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="visually-hidden"
            onChange={addFiles}
          />
          <p className="hint">
            Photos are resized in your browser before uploading and location data is not sent along.
          </p>
        </section>

        <section className="form-section" aria-labelledby="details-heading">
          <div className="form-section__head">
            <h2 id="details-heading">Caption and category</h2>
          </div>
          <label className="field">
            <span className="field__label">Caption</span>
            <textarea
              className="textarea"
              rows={3}
              maxLength={config.limits.maxCaptionLength}
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              placeholder="What is happening here? Hashtags work too."
            />
            <span className="field__hint">
              {caption.length}/{config.limits.maxCaptionLength}
            </span>
          </label>

          {hashtags.length ? (
            <p className="hashtag-preview">
              Tags: {hashtags.map((tag) => `#${tag}`).join(' ')}
            </p>
          ) : null}

          <label className="field">
            <span className="field__label">Category</span>
            <select
              className="select"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              {config.categories.map((option) => (
                <option value={option.id} key={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="field__hint">
              {config.categories.find((option) => option.id === category)?.blurb}
            </span>
          </label>
        </section>

        <section className="form-section" aria-labelledby="sound-heading">
          <div className="form-section__head">
            <h2 id="sound-heading">Sound</h2>
          </div>
          <div className="choices" role="radiogroup" aria-label="Sound">
            {(
              [
                ['none', 'No audio', 'Photos on their own.'],
                ['library', 'Use a sound', 'Borrow one someone already posted.'],
                ['upload', 'Upload audio', 'Add your own clip (up to ' + config.limits.maxAudioMb + ' MB).'],
              ] as const
            ).map(([value, label, hint]) => (
              <label key={value} className={`choice ${soundMode === value ? 'is-active' : ''}`}>
                <input
                  type="radio"
                  name="sound-mode"
                  value={value}
                  checked={soundMode === value}
                  onChange={() => setSoundMode(value)}
                />
                <span>
                  <strong>{label}</strong>
                  <span className="choice__hint">{hint}</span>
                </span>
              </label>
            ))}
          </div>

          {soundMode === 'library' ? (
            <div className="sound-picker">
              <label className="field">
                <span className="field__label">Search sounds</span>
                <input
                  className="input"
                  type="search"
                  value={libraryQuery}
                  onChange={(event) => setLibraryQuery(event.target.value)}
                  placeholder="Bleat, barn, evening…"
                />
              </label>
              {library.length === 0 ? (
                <p className="hint">No sounds yet. Upload one and it becomes available to everyone.</p>
              ) : (
                <ul className="sound-picker__list">
                  {library.map((sound) => (
                    <li key={sound.id}>
                      <label className={`sound-option ${selectedSound?.id === sound.id ? 'is-selected' : ''}`}>
                        <input
                          type="radio"
                          name="library-sound"
                          checked={selectedSound?.id === sound.id}
                          onChange={() => setSelectedSound(sound)}
                        />
                        <span className="sound-option__text">
                          <strong>{sound.title}</strong>
                          <span className="muted">
                            @{sound.owner.username} · {duration(sound.durationMs)} ·{' '}
                            {plural(sound.useCount, 'use', 'uses')}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {soundMode === 'upload' ? (
            <div className="audio-upload">
              <button type="button" className="button button--quiet" onClick={() => audioInput.current?.click()}>
                <Icon name="volume" size={17} />
                {audioFile ? 'Replace audio' : 'Choose audio file'}
              </button>
              <input
                ref={audioInput}
                type="file"
                accept="audio/mpeg,audio/mp4,audio/aac,audio/ogg,audio/wav"
                className="visually-hidden"
                onChange={(event) => chooseAudio(event.target.files?.[0] || null)}
              />
              {audioFile ? (
                <div className="audio-preview">
                  <p>
                    <strong>{audioFile.name}</strong>
                    <span className="muted"> · {duration(audioDuration)}</span>
                  </p>
                  <audio controls src={audioPreview} preload="metadata" />
                </div>
              ) : null}
              <label className="field">
                <span className="field__label">Sound name</span>
                <input
                  className="input"
                  value={soundTitle}
                  maxLength={60}
                  onChange={(event) => setSoundTitle(event.target.value)}
                  placeholder="Evening bleat"
                />
                <span className="field__hint">Others will see this when they borrow the sound.</span>
              </label>
            </div>
          ) : null}
        </section>

        <div className="review-note">
          <Icon name="shield" size={20} />
          <p>
            Every post goes to a person for review before it appears in any feed. Usually that means
            audio and photos are checked for animal welfare and that a goat is actually involved.
          </p>
        </div>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        {progress !== null ? (
          <div className="progress" role="status" aria-live="polite">
            <div className="progress__bar">
              <span style={{ width: `${progress}%` }} />
            </div>
            <span className="progress__label">
              {progress < 100 ? `Uploading ${progress}%` : 'Finishing up…'}
            </span>
          </div>
        ) : (
          <button type="button" className="button button--wide" onClick={submit} disabled={!ready || preparing}>
            Send for review
          </button>
        )}
        {!ready && !progress ? (
          <p className="hint hint--center">
            Add at least one photo{soundMode === 'library' ? ', choose a sound' : ''}
            {soundMode === 'upload' && !audioFile ? ' and attach audio' : ''} to continue.
          </p>
        ) : null}
      </div>

      <aside className="upload-aside">
        <section className="aside-block">
          <h2 className="aside-title">What gets checked</h2>
          <ul className="checklist">
            <li>A goat is the point of the photo.</li>
            <li>No distress, injury or unsafe handling.</li>
            <li>Your own photos, or credit given.</li>
          </ul>
          <Link to="/guidelines" className="text-link">
            Full guidelines
          </Link>
        </section>
        <section className="aside-block aside-block--quiet">
          <h2 className="aside-title">Multiple photos</h2>
          <p className="aside-text">
            Two or more photos become a sideways carousel on the post. The order here is the order
            people will swipe through.
          </p>
        </section>
        <button
          type="button"
          className="text-link text-link--button"
          onClick={() => navigate('/settings?tab=feed')}
        >
          How your feed is built
        </button>
      </aside>
    </div>
  );
}

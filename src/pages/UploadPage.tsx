import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { VideoDTO } from '../../shared/types.ts';
import { ApiError, uploadWithProgress } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useConfig } from '../lib/config.tsx';
import { useDocumentTitle } from '../lib/hooks.ts';
import { formatBytes, formatDuration } from '../lib/format.ts';
import { Icon } from '../components/Icon.tsx';
import { StatusTag } from '../components/StatusTag.tsx';

const ACCEPTED_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'];
const ACCEPTED_EXT = /\.(mp4|mov|webm|m4v)$/i;

type Phase = 'idle' | 'uploading' | 'processing' | 'success';

interface SelectedFile {
  file: File;
  previewUrl: string;
  duration: number | null;
}

export function UploadPage() {
  useDocumentTitle('Upload');
  const { user, loading } = useAuth();
  const config = useConfig();

  const [selected, setSelected] = useState<SelectedFile | null>(null);
  const [dragging, setDragging] = useState(false);
  const [caption, setCaption] = useState('');
  const [category, setCategory] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [fileError, setFileError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [lastUpload, setLastUpload] = useState<VideoDTO | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const probeId = useRef(0);

  const limits = config?.limits ?? {
    maxUploadMb: 200,
    maxDurationSeconds: 180,
    minDurationSeconds: 2,
    maxAvatarMb: 4,
    maxCaptionLength: 300,
    maxCommentsPerMinute: 12,
  };

  useEffect(() => {
    return () => {
      if (selected?.previewUrl) URL.revokeObjectURL(selected.previewUrl);
    };
  }, [selected]);

  const chooseFile = (file: File | undefined) => {
    if (!file) return;
    probeId.current += 1;
    const checked = probeId.current;
    setFileError(null);
    setError(null);
    setFields({});
    if (!ACCEPTED_TYPES.includes(file.type) && !ACCEPTED_EXT.test(file.name)) {
      setSelected(null);
      setFileError('Use an MP4, MOV, WEBM or M4V video. Those are the formats every browser can play.');
      return;
    }
    if (file.size > limits.maxUploadMb * 1024 * 1024) {
      setSelected(null);
      setFileError(`That file is ${formatBytes(file.size)}. The limit is ${limits.maxUploadMb} MB.`);
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    setSelected({ file, previewUrl, duration: null });

    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => {
      if (probeId.current !== checked) return;
      const duration = Number.isFinite(probe.duration) ? probe.duration : null;
      setSelected((current) => (current && current.previewUrl === previewUrl ? { ...current, duration } : current));
      if (duration !== null && duration > limits.maxDurationSeconds) {
        setFileError(
          `That clip is ${formatDuration(duration)}. Keep uploads under ${Math.round(limits.maxDurationSeconds / 60)} minutes.`,
        );
      } else if (duration !== null && duration < limits.minDurationSeconds) {
        setFileError(`That clip is only ${formatDuration(duration)}. Videos need to be at least ${limits.minDurationSeconds} seconds.`);
      }
    };
    probe.onerror = () => {
      if (probeId.current !== checked) return;
      setFileError('This browser could not read that file. Try exporting it as an MP4.');
    };
    probe.src = previewUrl;
  };

  const reset = () => {
    probeId.current += 1;
    if (selected) URL.revokeObjectURL(selected.previewUrl);
    setSelected(null);
    setCaption('');
    setCategory('');
    setHashtags('');
    setAccepted(false);
    setPhase('idle');
    setProgress(0);
    setFileError(null);
    setError(null);
    setFields({});
    if (inputRef.current) inputRef.current.value = '';
  };

  if (loading) {
    return (
      <div className="page">
        <div className="feed-empty">
          <div className="spinner spinner--dark" />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="page">
        <div className="empty-state" style={{ paddingTop: 48 }}>
          <Icon name="upload" size={26} />
          <h2>Sign in to upload</h2>
          <p>Uploads are tied to an account so the moderator knows who submitted the video.</p>
          <div className="empty-state__actions">
            <Link className="btn btn--primary" to="/login?next=/upload">
              Sign in
            </Link>
            <Link className="btn btn--quiet" to="/signup?next=/upload">
              Create an account
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'success') {
    return (
      <div className="page upload-page">
        <div className="upload-success">
          <span className="upload-success__mark">
            <Icon name="check" size={26} />
          </span>
          <h1>Sent for review</h1>
          <p>
            Thanks. A person will watch this before it appears on GoatMedia. You will get a notification when it is
            approved or if it needs changes.
          </p>
          {lastUpload ? (
            <div className="upload-success__card">
              {lastUpload.posterUrl ? <img src={lastUpload.posterUrl} alt="" /> : null}
              <div>
                <p className="upload-success__caption">{lastUpload.caption}</p>
                <div className="upload-success__meta">
                  <StatusTag status="pending" />
                  <span>{formatDuration(lastUpload.duration)}</span>
                </div>
              </div>
            </div>
          ) : null}
          <div className="form-actions">
            <Link className="btn btn--primary" to={`/u/${user.username}`}>
              View your uploads
            </Link>
            <button type="button" className="btn btn--quiet" onClick={reset}>
              Upload another
            </button>
          </div>
        </div>
      </div>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (fileError) return;
    setError(null);
    setFields({});
    const nextFields: Record<string, string> = {};
    if (!selected) setFileError('Choose a video first.');
    if (!caption.trim()) nextFields.caption = 'Add a short caption.';
    if (!category) nextFields.category = 'Pick a category.';
    if (!accepted) nextFields.guidelines = 'Confirm the guidelines.';
    if (Object.keys(nextFields).length) {
      setFields(nextFields);
      setError('Check the highlighted fields and try again.');
      return;
    }
    if (!selected) return;

    const form = new FormData();
    form.append('video', selected.file);
    form.append('caption', caption.trim());
    form.append('category', category);
    form.append('hashtags', hashtags);
    form.append('guidelines', 'accepted');
    if (selected.duration) form.append('duration', String(selected.duration));

    setPhase('uploading');
    setProgress(0);
    try {
      const data = await uploadWithProgress<{ video: VideoDTO; message: string }>(
        '/api/videos',
        form,
        setProgress,
        () => setPhase('processing'),
      );
      setLastUpload(data.video);
      setPhase('success');
      if (selected) URL.revokeObjectURL(selected.previewUrl);
      setSelected(null);
      setCaption('');
      setCategory('');
      setHashtags('');
      setAccepted(false);
    } catch (uploadError) {
      setPhase('idle');
      setProgress(0);
      if (uploadError instanceof ApiError) {
        setFields(uploadError.fields ?? {});
        setError(uploadError.message);
        if (/file|large|read|format/i.test(uploadError.message)) setFileError(uploadError.message);
      } else {
        setError(uploadError instanceof Error ? uploadError.message : 'The upload failed.');
      }
    }
  };

  return (
    <div className="page upload-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Upload a goat video</h1>
          <p className="page-sub">
            Every submission is watched by a person before it goes public. That is the whole moderation policy.
          </p>
        </div>
      </div>

      <form className="upload-layout" onSubmit={submit} noValidate>
        <div className="upload-main">
          <section className="upload-block">
            <h2 className="section-title">The video</h2>
            {selected ? (
              <div className="upload-preview">
                <video src={selected.previewUrl} controls preload="metadata" />
                <div className="upload-preview__bar">
                  <div className="upload-preview__info">
                    <strong>{selected.file.name}</strong>
                    <span>
                      {formatBytes(selected.file.size)}
                      {selected.duration ? ` · ${formatDuration(selected.duration)}` : ' · checking length…'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn--quiet btn--sm"
                    onClick={() => inputRef.current?.click()}
                    disabled={phase !== 'idle'}
                  >
                    Replace
                  </button>
                </div>
              </div>
            ) : (
              <div
                className={`dropzone${dragging ? ' is-dragging' : ''}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  chooseFile(event.dataTransfer.files?.[0]);
                }}
              >
                <Icon name="upload" size={24} />
                <p>Drop a video here, or choose a file.</p>
                <button type="button" className="btn btn--quiet" onClick={() => inputRef.current?.click()}>
                  Choose a video
                </button>
                <span className="dropzone__hint">
                  MP4, MOV, WEBM or M4V · up to {limits.maxUploadMb} MB ·{' '}
                  {Math.round(limits.maxDurationSeconds / 60)} minutes max
                </span>
              </div>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm,video/x-m4v"
              className="visually-hidden"
              id="video-file"
              onChange={(event) => chooseFile(event.target.files?.[0])}
            />
            {fileError ? <p className="field__error">{fileError}</p> : null}
          </section>

          <section className="upload-block">
            <h2 className="section-title">Details</h2>
            <div className="form-stack">
              <div className="field">
                <label className="field__label" htmlFor="caption">
                  Caption
                </label>
                <textarea
                  id="caption"
                  className="textarea"
                  value={caption}
                  maxLength={limits.maxCaptionLength}
                  onChange={(event) => setCaption(event.target.value)}
                  placeholder="What is happening in this video?"
                  aria-invalid={Boolean(fields.caption)}
                  aria-describedby="caption-help"
                  disabled={phase !== 'idle'}
                />
                <div className="field__between">
                  <span className="field__hint" id="caption-help">
                    Write it the way you would tell a friend. Hashtags are optional.
                  </span>
                  <span className="field__hint tabular">
                    {caption.length}/{limits.maxCaptionLength}
                  </span>
                </div>
                {fields.caption ? <span className="field__error">{fields.caption}</span> : null}
              </div>

              <div className="form-row">
                <div className="field">
                  <label className="field__label" htmlFor="category">
                    Category
                  </label>
                  <select
                    id="category"
                    className="select"
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                    aria-invalid={Boolean(fields.category)}
                    disabled={phase !== 'idle'}
                  >
                    <option value="">Choose a category</option>
                    {config?.categories.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                  {fields.category ? <span className="field__error">{fields.category}</span> : null}
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="hashtags">
                    Hashtags
                  </label>
                  <input
                    id="hashtags"
                    className="input"
                    value={hashtags}
                    onChange={(event) => setHashtags(event.target.value)}
                    placeholder="goatkids, climbing"
                    disabled={phase !== 'idle'}
                  />
                  <span className="field__hint">Up to 5, separated by spaces or commas.</span>
                </div>
              </div>

              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(event) => setAccepted(event.target.checked)}
                  disabled={phase !== 'idle'}
                />
                <span>
                  This is my own footage, it shows goats being treated well, and it follows the{' '}
                  <Link className="textlink" to="/guidelines">
                    community guidelines
                  </Link>
                  .
                </span>
              </label>
              {fields.guidelines ? <span className="field__error">{fields.guidelines}</span> : null}
            </div>
          </section>
        </div>

        <aside className="upload-side">
          <div className="upload-note">
            <h2 className="section-title">Before you upload</h2>
            <ul className="checklist">
              <li>Goats are the subject, not a background detail.</li>
              <li>No unsafe handling, baiting or distress.</li>
              <li>Horizontal or vertical both play fine.</li>
              <li>Location metadata is stripped during processing.</li>
            </ul>
          </div>
          <div className="upload-note upload-note--quiet">
            <div className="upload-note__row">
              <Icon name="clock" size={18} />
              <p>Most videos are reviewed within a day, depending on how many are waiting.</p>
            </div>
            <div className="upload-note__row">
              <Icon name="shield" size={18} />
              <p>Rejected videos stay private. Only you and the moderator can see them.</p>
            </div>
          </div>

          {phase !== 'idle' ? (
            <div className="upload-progress" role="status" aria-live="polite">
              <div className="upload-progress__label">
                <span>{phase === 'uploading' ? `Uploading · ${progress}%` : 'Checking your video…'}</span>
              </div>
              <div className="progressbar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
                <div className="progressbar__fill" style={{ width: phase === 'processing' ? '100%' : `${progress}%` }} />
              </div>
            </div>
          ) : null}

          {error ? <p className="field__error" role="alert">{error}</p> : null}

          <button
            type="submit"
            className="btn btn--primary btn--lg btn--block"
            disabled={phase !== 'idle' || !selected || Boolean(fileError)}
          >
            {phase !== 'idle' ? <span className="btn__spinner" /> : null}
            {phase === 'uploading' ? 'Uploading…' : phase === 'processing' ? 'Checking…' : 'Submit for review'}
          </button>
          <p className="upload-side__hint">
            Nothing is published automatically. A human approves every video.
          </p>
        </aside>
      </form>
    </div>
  );
}

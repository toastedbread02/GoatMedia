import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { SoundLibraryItem, VideoDTO } from '../../shared/types.ts';
import { api, ApiError, uploadVideo, uploadWithProgress } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useConfig } from '../lib/config.tsx';
import { useDocumentTitle } from '../lib/hooks.ts';
import { formatBytes, formatDuration } from '../lib/format.ts';
import { capturePoster, resizePhoto } from '../lib/image.ts';
import { Icon } from '../components/Icon.tsx';
import { StatusTag } from '../components/StatusTag.tsx';

const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'];
const VIDEO_EXT = /\.(mp4|mov|webm|m4v)$/i;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

type Kind = 'video' | 'photos';
type Phase = 'idle' | 'uploading' | 'processing' | 'success';
type SoundMode = 'none' | 'library' | 'upload';

interface VideoChoice {
  file: File;
  previewUrl: string;
  duration: number | null;
  width: number;
  height: number;
  poster: Blob | null;
}

interface PhotoChoice {
  key: string;
  blob: Blob;
  previewUrl: string;
  name: string;
}

export function UploadPage() {
  useDocumentTitle('Upload');
  const { user, loading } = useAuth();
  const config = useConfig();

  const [kind, setKind] = useState<Kind>('video');
  const [video, setVideo] = useState<VideoChoice | null>(null);
  const [photos, setPhotos] = useState<PhotoChoice[]>([]);
  const [dragging, setDragging] = useState(false);
  const [preparing, setPreparing] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [category, setCategory] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [soundMode, setSoundMode] = useState<SoundMode>('none');
  const [library, setLibrary] = useState<SoundLibraryItem[]>([]);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [selectedSound, setSelectedSound] = useState<SoundLibraryItem | null>(null);
  const [audio, setAudio] = useState<{ file: File; durationMs: number } | null>(null);
  const [soundTitle, setSoundTitle] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [fileError, setFileError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [lastUpload, setLastUpload] = useState<VideoDTO | null>(null);

  const videoInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const probeId = useRef(0);
  const photoKey = useRef(0);

  const limits = config?.limits ?? {
    maxUploadMb: 25,
    maxVideoMb: 25,
    maxDurationSeconds: 60,
    minDurationSeconds: 1,
    maxPhotos: 6,
    maxPhotoMb: 1.8,
    maxAudioMb: 1.5,
    maxAvatarMb: 0.4,
    maxCaptionLength: 300,
    maxCommentsPerMinute: 12,
  };

  useEffect(() => {
    return () => {
      if (video?.previewUrl) URL.revokeObjectURL(video.previewUrl);
    };
  }, [video]);

  useEffect(() => {
    return () => {
      for (const photo of photos) URL.revokeObjectURL(photo.previewUrl);
    };
    // Only revoke what was mounted; individual removals revoke their own URL.
  }, []);

  useEffect(() => {
    if (kind !== 'photos' || soundMode !== 'library') return;
    let cancelled = false;
    api
      .get<{ sounds: SoundLibraryItem[] }>(`/api/sounds?q=${encodeURIComponent(libraryQuery)}&page=1`)
      .then((data) => {
        if (!cancelled) setLibrary(data.sounds);
      })
      .catch(() => {
        if (!cancelled) setLibrary([]);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, soundMode, libraryQuery]);

  const chooseVideo = async (file: File | undefined) => {
    if (!file) return;
    probeId.current += 1;
    const checked = probeId.current;
    setFileError(null);
    setError(null);
    setFields({});

    if (!VIDEO_TYPES.includes(file.type) && !VIDEO_EXT.test(file.name)) {
      setVideo(null);
      setFileError('Use an MP4, MOV, WEBM or M4V video. Those are the formats every browser can play.');
      return;
    }
    if (file.size > limits.maxVideoMb * 1024 * 1024) {
      setVideo(null);
      setFileError(`That file is ${formatBytes(file.size)}. The limit is ${limits.maxVideoMb} MB.`);
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setPreparing('Reading the clip…');
    setVideo({ file, previewUrl, duration: null, width: 0, height: 0, poster: null });

    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.src = previewUrl;
    probe.onloadedmetadata = async () => {
      if (probeId.current !== checked) return;
      const duration = Number.isFinite(probe.duration) ? probe.duration : null;
      const width = probe.videoWidth;
      const height = probe.videoHeight;
      if (duration !== null && duration > limits.maxDurationSeconds + 0.5) {
        setFileError(
          `That clip is ${formatDuration(duration)}. Clips are limited to ${limits.maxDurationSeconds} seconds.`,
        );
        setVideo(null);
        setPreparing(null);
        URL.revokeObjectURL(previewUrl);
        return;
      }
      if (duration !== null && duration < limits.minDurationSeconds - 0.3) {
        setFileError(`That clip is only ${formatDuration(duration)}. Clips start at ${limits.minDurationSeconds} second.`);
        setVideo(null);
        setPreparing(null);
        URL.revokeObjectURL(previewUrl);
        return;
      }
      setPreparing('Grabbing a preview frame…');
      const shot = duration !== null ? await capturePoster(file, duration) : { poster: null, width, height };
      if (probeId.current !== checked) return;
      setVideo({
        file,
        previewUrl,
        duration,
        width: shot.width || width,
        height: shot.height || height,
        poster: shot.poster,
      });
      setPreparing(null);
    };
    probe.onerror = () => {
      if (probeId.current !== checked) return;
      setFileError('This browser could not read that file. Try exporting it as an MP4.');
      setVideo(null);
      setPreparing(null);
    };
  };

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setFileError(null);
    setError(null);
    setFields({});
    const room = limits.maxPhotos - photos.length;
    if (room <= 0) {
      setFileError(`Up to ${limits.maxPhotos} photos in one post.`);
      return;
    }
    const chosen = Array.from(files).slice(0, room);
    if (Array.from(files).length > room) {
      setFileError(`Only the first ${room} photos were added. A post holds ${limits.maxPhotos}.`);
    }
    setPreparing('Preparing photos…');
    const next: PhotoChoice[] = [];
    for (const file of chosen) {
      if (!PHOTO_TYPES.includes(file.type)) {
        setFileError('Photos need to be JPEG, PNG or WebP. iPhone HEIC files should be converted first.');
        continue;
      }
      try {
        const blob = await resizePhoto(file, { maxDimension: 1800, maxBytes: limits.maxPhotoMb * 1024 * 1024 });
        photoKey.current += 1;
        next.push({
          key: `photo-${photoKey.current}`,
          blob,
          previewUrl: URL.createObjectURL(blob),
          name: file.name,
        });
      } catch (photoError) {
        setFileError(photoError instanceof Error ? photoError.message : 'That photo could not be read.');
      }
    }
    setPhotos((current) => [...current, ...next].slice(0, limits.maxPhotos));
    setPreparing(null);
  };

  const removePhoto = (key: string) => {
    setPhotos((current) => {
      const target = current.find((photo) => photo.key === key);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((photo) => photo.key !== key);
    });
  };

  const movePhoto = (key: string, direction: -1 | 1) => {
    setPhotos((current) => {
      const index = current.findIndex((photo) => photo.key === key);
      const next = index + direction;
      if (index < 0 || next < 0 || next >= current.length) return current;
      const copy = [...current];
      [copy[index], copy[next]] = [copy[next], copy[index]];
      return copy;
    });
  };

  const chooseAudio = async (file: File | undefined) => {
    if (!file) return;
    if (!/^audio\//.test(file.type)) {
      setFileError('Audio needs to be an MP3, M4A, AAC, OGG or WAV file.');
      return;
    }
    if (file.size > limits.maxAudioMb * 1024 * 1024) {
      setFileError(`Audio is limited to ${limits.maxAudioMb} MB.`);
      return;
    }
    setFileError(null);
    const url = URL.createObjectURL(file);
    const probe = document.createElement('audio');
    probe.preload = 'metadata';
    probe.src = url;
    const durationMs = await new Promise<number>((resolve) => {
      probe.onloadedmetadata = () => resolve(Number.isFinite(probe.duration) ? probe.duration * 1000 : 0);
      probe.onerror = () => resolve(0);
      window.setTimeout(() => resolve(0), 1500);
    });
    URL.revokeObjectURL(url);
    setAudio({ file, durationMs });
    if (!soundTitle) setSoundTitle(file.name.replace(/\.[^.]+$/, '').slice(0, 60));
  };

  const reset = () => {
    probeId.current += 1;
    if (video) URL.revokeObjectURL(video.previewUrl);
    for (const photo of photos) URL.revokeObjectURL(photo.previewUrl);
    setVideo(null);
    setPhotos([]);
    setCaption('');
    setCategory('');
    setAccepted(false);
    setSoundMode('none');
    setSelectedSound(null);
    setAudio(null);
    setSoundTitle('');
    setPhase('idle');
    setProgress(0);
    setFileError(null);
    setError(null);
    setFields({});
    if (videoInput.current) videoInput.current.value = '';
    if (photoInput.current) photoInput.current.value = '';
    if (audioInput.current) audioInput.current.value = '';
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
          <p>Uploads are tied to an account so the moderator knows who submitted the post.</p>
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
            Thanks. A person will {lastUpload?.kind === 'video' ? 'watch' : 'look at'} this before it appears on
            GoatMedia. You will get a notification when it is approved or if it needs changes.
          </p>
          {lastUpload ? (
            <div className="upload-success__card">
              {lastUpload.posterUrl ? <img src={lastUpload.posterUrl} alt="" /> : null}
              <div>
                <p className="upload-success__caption">{lastUpload.caption}</p>
                <div className="upload-success__meta">
                  <StatusTag status="pending" />
                  <span>
                    {lastUpload.kind === 'photos'
                      ? `${lastUpload.photos.length} ${lastUpload.photos.length === 1 ? 'photo' : 'photos'}`
                      : formatDuration(lastUpload.duration)}
                  </span>
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
    if (kind === 'video' && !video) nextFields.file = 'Choose a video first.';
    if (kind === 'photos' && photos.length === 0) nextFields.file = 'Add at least one photo.';
    if (!caption.trim()) nextFields.caption = 'Add a short caption.';
    if (!category) nextFields.category = 'Pick a category.';
    if (!accepted) nextFields.guidelines = 'Confirm the guidelines.';
    if (kind === 'photos' && soundMode === 'library' && !selectedSound) {
      nextFields.sound = 'Choose a sound, or pick no audio.';
    }
    if (kind === 'photos' && soundMode === 'upload' && !audio) {
      nextFields.sound = 'Attach an audio file, or pick no audio.';
    }
    if (Object.keys(nextFields).length) {
      setFields(nextFields);
      setError('Check the highlighted fields and try again.');
      return;
    }

    setPhase('uploading');
    setProgress(0);
    try {
      if (kind === 'video' && video) {
        const uploadId = await uploadVideo(
          video.file,
          video.poster,
          { duration: video.duration ?? 0, width: video.width, height: video.height },
          setProgress,
        );
        setPhase('processing');
        const form = new FormData();
        form.append('kind', 'video');
        form.append('uploadId', uploadId);
        form.append('durationMs', String(Math.round((video.duration ?? 0) * 1000)));
        form.append('width', String(video.width || 0));
        form.append('height', String(video.height || 0));
        form.append('caption', caption.trim());
        form.append('category', category);
        const data = await uploadWithProgress<{ video: VideoDTO; post: VideoDTO; message: string }>(
          '/api/posts',
          form,
          () => {},
        );
        setLastUpload(data.video ?? data.post);
      } else {
        const form = new FormData();
        form.append('kind', 'photos');
        form.append('caption', caption.trim());
        form.append('category', category);
        photos.forEach((photo, index) => {
          form.append('photos', photo.blob, `photo-${index + 1}.jpg`);
        });
        form.append('soundMode', soundMode);
        if (soundMode === 'library' && selectedSound) form.append('soundId', selectedSound.id);
        if (soundMode === 'upload' && audio) {
          form.append('audio', audio.file);
          form.append('audioDurationMs', String(Math.round(audio.durationMs)));
          form.append('soundTitle', soundTitle.slice(0, 60));
        }
        const data = await uploadWithProgress<{ video: VideoDTO; post: VideoDTO; message: string }>(
          '/api/posts',
          form,
          setProgress,
        );
        setLastUpload(data.video ?? data.post);
      }
      setPhase('success');
      if (video) URL.revokeObjectURL(video.previewUrl);
      for (const photo of photos) URL.revokeObjectURL(photo.previewUrl);
      setVideo(null);
      setPhotos([]);
      setCaption('');
      setCategory('');
      setAccepted(false);
      setSelectedSound(null);
      setAudio(null);
      setSoundMode('none');
    } catch (uploadError) {
      setPhase('idle');
      setProgress(0);
      if (uploadError instanceof ApiError) {
        setFields(uploadError.fields ?? {});
        setError(uploadError.message);
        if (/file|large|read|format|video|photo/i.test(uploadError.message)) setFileError(uploadError.message);
      } else {
        setError(uploadError instanceof Error ? uploadError.message : 'The upload failed.');
      }
    }
  };

  const busy = phase !== 'idle';

  return (
    <div className="page upload-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Post a goat</h1>
          <p className="page-sub">
            A clip or a small photo album. Every submission is watched by a person before it goes public.
          </p>
        </div>
      </div>

      <form className="upload-layout" onSubmit={submit} noValidate>
        <div className="upload-main">
          <section className="upload-block">
            <h2 className="section-title">What are you posting?</h2>
            <div className="radio-list" role="radiogroup" aria-label="Post type">
              <label className={`radio-list__item${kind === 'video' ? ' is-selected' : ''}`}>
                <input
                  type="radio"
                  name="kind"
                  value="video"
                  checked={kind === 'video'}
                  onChange={() => {
                    setKind('video');
                    setFileError(null);
                  }}
                  disabled={busy}
                />
                <span>
                  <strong>Video</strong>
                  <span className="field__hint">
                    One clip, up to {limits.maxDurationSeconds} seconds and {limits.maxVideoMb} MB.
                  </span>
                </span>
              </label>
              <label className={`radio-list__item${kind === 'photos' ? ' is-selected' : ''}`}>
                <input
                  type="radio"
                  name="kind"
                  value="photos"
                  checked={kind === 'photos'}
                  onChange={() => {
                    setKind('photos');
                    setFileError(null);
                  }}
                  disabled={busy}
                />
                <span>
                  <strong>Photos</strong>
                  <span className="field__hint">
                    One to {limits.maxPhotos} photos. Several photos scroll sideways, like a small album.
                  </span>
                </span>
              </label>
            </div>
          </section>

          {kind === 'video' ? (
            <section className="upload-block">
              <h2 className="section-title">The video</h2>
              {video ? (
                <div className="upload-preview">
                  <video src={video.previewUrl} controls preload="metadata" playsInline />
                  <div className="upload-preview__bar">
                    <div className="upload-preview__info">
                      <strong>{video.file.name}</strong>
                      <span>
                        {formatBytes(video.file.size)}
                        {video.duration ? ` · ${formatDuration(video.duration)}` : ' · checking length…'}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn btn--quiet btn--sm"
                      onClick={() => videoInput.current?.click()}
                      disabled={busy}
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
                    void chooseVideo(event.dataTransfer.files?.[0]);
                  }}
                >
                  <Icon name="upload" size={24} />
                  <p>Drop a video here, or choose a file.</p>
                  <button type="button" className="btn btn--quiet" onClick={() => videoInput.current?.click()}>
                    Choose a video
                  </button>
                  <span className="dropzone__hint">
                    MP4, MOV, WEBM or M4V · up to {limits.maxVideoMb} MB · {limits.maxDurationSeconds} seconds max
                  </span>
                </div>
              )}
              <input
                ref={videoInput}
                type="file"
                accept="video/mp4,video/quicktime,video/webm,video/x-m4v"
                className="visually-hidden"
                id="video-file"
                onChange={(event) => void chooseVideo(event.target.files?.[0])}
              />
              {preparing ? <p className="field__hint">{preparing}</p> : null}
              {fileError ? <p className="field__error">{fileError}</p> : null}
            </section>
          ) : (
            <section className="upload-block">
              <h2 className="section-title">
                Photos <span className="field__hint">{photos.length}/{limits.maxPhotos}</span>
              </h2>
              {photos.length ? (
                <ul className="photo-grid">
                  {photos.map((photo, index) => (
                    <li className="photo-grid__item" key={photo.key}>
                      <img src={photo.previewUrl} alt="" />
                      <span className="photo-grid__index">{index + 1}</span>
                      <div className="photo-grid__actions">
                        <button
                          type="button"
                          className="photo-grid__btn"
                          aria-label={`Move ${photo.name} earlier`}
                          onClick={() => movePhoto(photo.key, -1)}
                          disabled={index === 0 || busy}
                        >
                          <Icon name="chevron-left" size={14} />
                        </button>
                        <button
                          type="button"
                          className="photo-grid__btn"
                          aria-label={`Move ${photo.name} later`}
                          onClick={() => movePhoto(photo.key, 1)}
                          disabled={index === photos.length - 1 || busy}
                        >
                          <Icon name="chevron-right" size={14} />
                        </button>
                        <button
                          type="button"
                          className="photo-grid__btn photo-grid__btn--remove"
                          aria-label={`Remove ${photo.name}`}
                          onClick={() => removePhoto(photo.key)}
                          disabled={busy}
                        >
                          <Icon name="close" size={14} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
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
                    void addPhotos(event.dataTransfer.files);
                  }}
                >
                  <Icon name="image" size={24} />
                  <p>Drop photos here, or choose them from your device.</p>
                  <button type="button" className="btn btn--quiet" onClick={() => photoInput.current?.click()}>
                    Choose photos
                  </button>
                  <span className="dropzone__hint">
                    JPEG, PNG or WebP · up to {limits.maxPhotos} · resized before upload, location data removed
                  </span>
                </div>
              )}
              {photos.length > 0 && photos.length < limits.maxPhotos ? (
                <button
                  type="button"
                  className="btn btn--quiet btn--sm photo-add"
                  onClick={() => photoInput.current?.click()}
                  disabled={busy}
                >
                  <Icon name="plus" size={16} /> Add another photo
                </button>
              ) : null}
              <input
                ref={photoInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="visually-hidden"
                id="photo-files"
                onChange={(event) => void addPhotos(event.target.files)}
              />
              {preparing ? <p className="field__hint">{preparing}</p> : null}
              {fields.file ? <p className="field__error">{fields.file}</p> : null}
              {fileError ? <p className="field__error">{fileError}</p> : null}
            </section>
          )}

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
                  placeholder={kind === 'video' ? 'What is happening in this clip?' : 'What is happening in these photos?'}
                  aria-invalid={Boolean(fields.caption)}
                  aria-describedby="caption-help"
                  disabled={busy}
                />
                <div className="field__between">
                  <span className="field__hint" id="caption-help">
                    Hashtags are optional and work right in the caption.
                  </span>
                  <span className="field__hint tabular">
                    {caption.length}/{limits.maxCaptionLength}
                  </span>
                </div>
                {fields.caption ? <span className="field__error">{fields.caption}</span> : null}
              </div>

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
                  disabled={busy}
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

              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(event) => setAccepted(event.target.checked)}
                  disabled={busy}
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

          {kind === 'photos' ? (
            <section className="upload-block">
              <h2 className="section-title">Sound</h2>
              <div className="radio-list" role="radiogroup" aria-label="Sound">
                {(
                  [
                    ['none', 'No audio', 'Photos on their own.'],
                    ['library', 'Use a sound', 'Borrow one someone already posted.'],
                    ['upload', 'Upload audio', `Add your own clip, up to ${limits.maxAudioMb} MB.`],
                  ] as const
                ).map(([value, label, hint]) => (
                  <label key={value} className={`radio-list__item${soundMode === value ? ' is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="sound-mode"
                      value={value}
                      checked={soundMode === value}
                      onChange={() => setSoundMode(value)}
                      disabled={busy}
                    />
                    <span>
                      <strong>{label}</strong>
                      <span className="field__hint">{hint}</span>
                    </span>
                  </label>
                ))}
              </div>

              {soundMode === 'library' ? (
                <div className="sound-pick">
                  <div className="field">
                    <label className="field__label" htmlFor="sound-search">
                      Search the shared sounds
                    </label>
                    <input
                      id="sound-search"
                      className="input"
                      value={libraryQuery}
                      onChange={(event) => setLibraryQuery(event.target.value)}
                      placeholder="bleat, barn, evening…"
                      disabled={busy}
                    />
                  </div>
                  {library.length === 0 ? (
                    <p className="section-note">No sounds yet. Upload one and it becomes available to everyone.</p>
                  ) : (
                    <ul className="sound-pick__list">
                      {library.map((sound) => (
                        <li key={sound.id}>
                          <label className={`sound-pick__item${selectedSound?.id === sound.id ? ' is-selected' : ''}`}>
                            <input
                              type="radio"
                              name="library-sound"
                              checked={selectedSound?.id === sound.id}
                              onChange={() => setSelectedSound(sound)}
                              disabled={busy}
                            />
                            <span>
                              <strong>{sound.title}</strong>
                              <span className="field__hint">
                                @{sound.owner.username} · {formatDuration(sound.durationMs / 1000)} ·{' '}
                                {sound.useCount} {sound.useCount === 1 ? 'use' : 'uses'}
                              </span>
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                  {fields.sound ? <p className="field__error">{fields.sound}</p> : null}
                </div>
              ) : null}

              {soundMode === 'upload' ? (
                <div className="form-stack sound-pick">
                  <div className="field">
                    <span className="field__label">Audio file</span>
                    <button
                      type="button"
                      className="btn btn--quiet btn--sm"
                      onClick={() => audioInput.current?.click()}
                      disabled={busy}
                    >
                      {audio ? `Replace ${audio.file.name}` : 'Choose an audio file'}
                    </button>
                    <span className="field__hint">MP3, M4A, AAC, OGG or WAV.</span>
                  </div>
                  <input
                    ref={audioInput}
                    type="file"
                    accept="audio/mpeg,audio/mp4,audio/aac,audio/ogg,audio/wav"
                    className="visually-hidden"
                    id="audio-file"
                    onChange={(event) => void chooseAudio(event.target.files?.[0])}
                  />
                  <div className="field">
                    <label className="field__label" htmlFor="sound-title">
                      Sound name
                    </label>
                    <input
                      id="sound-title"
                      className="input"
                      value={soundTitle}
                      maxLength={60}
                      onChange={(event) => setSoundTitle(event.target.value)}
                      placeholder="Name this sound"
                      disabled={busy}
                    />
                    <span className="field__hint">Other people will see this when they borrow it.</span>
                  </div>
                  {fields.sound ? <p className="field__error">{fields.sound}</p> : null}
                </div>
              ) : (
                <p className="field__hint">
                  A video brings its own audio. Photos can stay silent or borrow a shared sound.
                </p>
              )}
            </section>
          ) : null}
        </div>

        <aside className="upload-side">
          <div className="upload-note">
            <h2 className="section-title">Before you upload</h2>
            <ul className="checklist">
              <li>Goats are the subject, not a background detail.</li>
              <li>No unsafe handling, baiting or distress.</li>
              <li>Horizontal or vertical both play fine.</li>
              <li>Location metadata is stripped before upload.</li>
            </ul>
          </div>
          <div className="upload-note upload-note--quiet">
            <div className="upload-note__row">
              <Icon name="clock" size={18} />
              <p>Most posts are reviewed within a day, depending on how many are waiting.</p>
            </div>
            <div className="upload-note__row">
              <Icon name="shield" size={18} />
              <p>Pending posts stay private. Only you and the moderator can see them.</p>
            </div>
          </div>

          {busy ? (
            <div className="upload-progress" role="status" aria-live="polite">
              <div className="upload-progress__label">
                <span>
                  {phase === 'uploading'
                    ? `Uploading · ${progress}%`
                    : kind === 'video'
                      ? 'Sending it for review…'
                      : 'Uploading photos…'}
                </span>
              </div>
              <div
                className="progressbar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
              >
                <div
                  className="progressbar__fill"
                  style={{ width: phase === 'processing' ? '100%' : `${progress}%` }}
                />
              </div>
            </div>
          ) : null}

          {error ? (
            <p className="field__error" role="alert">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            className="btn btn--primary btn--lg btn--block"
            disabled={busy || Boolean(fileError) || (kind === 'video' ? !video : photos.length === 0)}
          >
            {busy ? <span className="btn__spinner" /> : null}
            {phase === 'uploading' ? 'Uploading…' : phase === 'processing' ? 'Sending…' : 'Submit for review'}
          </button>
          <p className="upload-side__hint">Nothing is published automatically. A human approves every post.</p>
        </aside>
      </form>
    </div>
  );
}

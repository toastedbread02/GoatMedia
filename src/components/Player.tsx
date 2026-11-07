import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon.tsx';
import { formatDuration } from '../lib/format.ts';

export interface WatchStats {
  watchSeconds: number;
  completed: boolean;
  rewatched: boolean;
}

interface PlayerProps {
  src: string;
  poster?: string | null;
  active: boolean;
  className?: string;
  onWatch?: (stats: WatchStats) => void;
  mutedByDefault?: boolean;
  /** Buffer this clip while it waits its turn, so it starts without a stall. */
  warm?: boolean;
}

const MUTE_KEY = 'goatmedia:muted';
const VOLUME_KEY = 'goatmedia:volume';

function readMuted() {
  const stored = localStorage.getItem(MUTE_KEY);
  return stored === null ? true : stored === '1';
}

function readVolume() {
  const stored = Number(localStorage.getItem(VOLUME_KEY));
  return Number.isFinite(stored) && stored >= 0 && stored <= 1 ? stored : 0.8;
}

function applyMuted(muted: boolean) {
  localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
}

function VolumeSlider({ value, onChange, label }: { value: number; onChange: (next: number) => void; label: string }) {
  const rail = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [visual, setVisual] = useState(value);

  useEffect(() => {
    if (!dragging) setVisual(value);
  }, [value, dragging]);

  const positionFromEvent = (clientX: number) => {
    const element = rail.current;
    if (!element) return { clamped: value, damped: value };
    const rect = element.getBoundingClientRect();
    const raw = rect.width ? (clientX - rect.left) / rect.width : 0;
    const clamped = Math.min(1, Math.max(0, raw));
    // Rubber band: past either end, movement is damped rather than ignored.
    const damped = raw < 0 ? raw * 0.22 : raw > 1 ? 1 + (raw - 1) * 0.22 : raw;
    return { clamped, damped };
  };

  const update = (clientX: number) => {
    const { clamped, damped } = positionFromEvent(clientX);
    setVisual(damped);
    onChange(clamped);
  };

  return (
    <div
      className={`volume-slider${dragging ? ' is-dragging' : ''}`}
      ref={rail}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      aria-valuetext={`${Math.round(value * 100)} percent`}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        update(event.clientX);
      }}
      onPointerMove={(event) => {
        if (dragging) update(event.clientX);
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId);
        setDragging(false);
        const { clamped } = positionFromEvent(event.clientX);
        onChange(clamped);
        setVisual(clamped);
      }}
      onPointerCancel={() => {
        setDragging(false);
        setVisual(value);
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 0.1 : 0.05;
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
          event.preventDefault();
          onChange(Math.min(1, value + step));
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
          event.preventDefault();
          onChange(Math.max(0, value - step));
        } else if (event.key === 'Home') {
          event.preventDefault();
          onChange(0);
        } else if (event.key === 'End') {
          event.preventDefault();
          onChange(1);
        }
      }}
    >
      <div className="volume-slider__rail">
        <div className="volume-slider__fill" style={{ width: `${Math.min(100, Math.max(0, visual * 100))}%` }} />
        <span className="volume-slider__knob" style={{ left: `${Math.min(110, Math.max(-10, visual * 100))}%` }} />
      </div>
    </div>
  );
}

export function Player({ src, poster, active, className = '', onWatch, warm = false }: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [started, setStarted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [error, setError] = useState(false);
  const [muted, setMuted] = useState(readMuted);
  const [volume, setVolume] = useState(readVolume);
  const [soundHintDismissed, setSoundHintDismissed] = useState(false);
  const [preloadMode, setPreloadMode] = useState<'auto' | 'metadata'>(active ? 'auto' : 'metadata');

  const lastTime = useRef(0);
  const played = useRef(0);
  const completed = useRef(false);
  const rewatched = useRef(false);
  const endedOnce = useRef(false);
  const wasActive = useRef(false);
  const onWatchRef = useRef(onWatch);
  onWatchRef.current = onWatch;

  const sendStats = useCallback(() => {
    // Only report videos that actually became the active slide. Adjacent
    // videos are mounted early for smooth playback, and reporting those as
    // zero-second "skips" would punish videos nobody has seen yet.
    if (!wasActive.current) return;
    onWatchRef.current?.({
      watchSeconds: Math.round(played.current * 10) / 10,
      completed: completed.current,
      rewatched: rewatched.current,
    });
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = muted;
  }, [volume, muted]);

  // Warm the next clip only once the current one has started, so the clip on
  // screen gets the bandwidth first. Saving data and slow links skip it.
  useEffect(() => {
    if (active) {
      setPreloadMode('auto');
      return;
    }
    if (!warm) {
      setPreloadMode('metadata');
      return;
    }
    const connection = (navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }).connection;
    if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? '')) return;
    const timer = window.setTimeout(() => setPreloadMode('auto'), 1200);
    return () => window.clearTimeout(timer);
  }, [active, warm]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!active) {
      video.pause();
      return;
    }
    wasActive.current = true;
    if (endedOnce.current) {
      rewatched.current = true;
      completed.current = false;
      played.current = 0;
      endedOnce.current = false;
      video.currentTime = 0;
    }
    const attempt = video.play();
    if (attempt) {
      attempt.catch(() => {
        video.muted = true;
        setMuted(true);
        applyMuted(true);
        video.play().catch(() => {});
      });
    }
  }, [active]);

  useEffect(() => {
    return () => {
      sendStats();
    };
  }, [sendStats]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      if (!video.paused) {
        const delta = video.currentTime - lastTime.current;
        if (delta > 0 && delta < 1.5) played.current += delta;
        lastTime.current = video.currentTime;
      }
      if (video.duration && video.currentTime >= video.duration - 0.35) completed.current = true;
    };
    const handlePlay = () => {
      setPlaying(true);
      lastTime.current = video.currentTime;
      if (endedOnce.current) rewatched.current = true;
    };
    const handlePause = () => {
      setPlaying(false);
      sendStats();
    };
    const handleEnded = () => {
      completed.current = true;
      endedOnce.current = true;
      setPlaying(false);
      sendStats();
    };
    const handleWaiting = () => setWaiting(true);
    const handlePlaying = () => {
      setWaiting(false);
      setStarted(true);
      lastTime.current = video.currentTime;
    };
    const handleMetadata = () => setDuration(video.duration || 0);
    const handleError = () => {
      setError(true);
      setWaiting(false);
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('loadedmetadata', handleMetadata);
    video.addEventListener('error', handleError);
    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('loadedmetadata', handleMetadata);
      video.removeEventListener('error', handleError);
    };
  }, [sendStats]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      if (video.ended) {
        video.currentTime = 0;
        completed.current = false;
        if (endedOnce.current) rewatched.current = true;
      }
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  };

  const changeVolume = (next: number) => {
    setVolume(next);
    localStorage.setItem(VOLUME_KEY, String(next));
    if (next > 0 && muted) {
      setMuted(false);
      applyMuted(false);
    }
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    applyMuted(next);
    if (!next && volume === 0) changeVolume(0.6);
  };

  const toggleFullscreen = () => {
    const element = stageRef.current;
    if (!element) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else element.requestFullscreen().catch(() => {});
  };

  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div
      className={`feed-stage ${className}`}
      ref={stageRef}
      data-state={playing ? 'playing' : 'paused'}
    >
      {poster && !started ? <img className="feed-poster" src={poster} alt="" /> : null}
      <video
        ref={videoRef}
        src={src}
        poster={poster ?? undefined}
        playsInline
        preload={preloadMode}
        onClick={togglePlay}
        muted={muted}
        aria-label="Goat video"
      />

      {waiting && !error ? (
        <div className="stage-loading">
          <div className="spinner" />
        </div>
      ) : null}

      {!playing && !waiting && !error ? (
        <div className="stage-center">
          <button type="button" className="stage-play" onClick={togglePlay} aria-label="Play video">
            <Icon name="play" size={26} filled strokeWidth={0} />
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="stage-error">
          <Icon name="alert" size={22} />
          <p>This video will not play. It may still be processing or the connection dropped.</p>
          <button
            type="button"
            className="btn btn--quiet btn--sm"
            onClick={() => {
              setError(false);
              videoRef.current?.load();
              videoRef.current?.play().catch(() => {});
            }}
          >
            Try again
          </button>
        </div>
      ) : null}

      {muted && playing && !soundHintDismissed ? (
        <button
          type="button"
          className="sound-hint"
          onClick={() => {
            toggleMute();
            setSoundHintDismissed(true);
          }}
        >
          <Icon name="mute" size={15} /> Sound on
        </button>
      ) : null}

      <div className="stage-controls">
        <button type="button" className="stage-controls__btn" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
          <Icon name={playing ? 'pause' : 'play'} size={18} filled strokeWidth={0} />
        </button>
        <span className="stage-time tabular">
          {formatDuration(currentTime)} / {formatDuration(duration)}
        </span>
        <div className="seekwrap">
          <div className="seekwrap__rail">
            <div className="seekwrap__fill" style={{ width: `${progress}%` }} />
          </div>
          <input
            className="seekwrap__input"
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            aria-label="Seek video"
            onChange={(event) => {
              const next = Number(event.target.value);
              if (videoRef.current) videoRef.current.currentTime = next;
              setCurrentTime(next);
            }}
          />
          <span className="seekwrap__knob" style={{ left: `${progress}%` }} />
        </div>
        <div className="volwrap">
          <button
            type="button"
            className="stage-controls__btn"
            onClick={toggleMute}
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            <Icon name={muted ? 'mute' : 'volume'} size={18} />
          </button>
          <VolumeSlider value={muted ? 0 : volume} onChange={changeVolume} label="Volume" />
        </div>
        <button
          type="button"
          className="stage-controls__btn stage-controls__fullscreen"
          onClick={toggleFullscreen}
          aria-label="Full screen"
        >
          <Icon name="fullscreen" size={18} />
        </button>
      </div>
    </div>
  );
}

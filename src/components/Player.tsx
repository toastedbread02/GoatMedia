import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon.tsx';

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
/** Fixed listening level now that there is no volume slider to set one. */
const PLAYBACK_VOLUME = 0.85;

function readMuted() {
  // Sound is on for a first visit. Only a deliberate mute is remembered, and a
  // browser that blocks unmuted autoplay falls back to muted silently.
  return localStorage.getItem(MUTE_KEY) === '1';
}

function applyMuted(muted: boolean) {
  localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
}

export function Player({ src, poster, active, className = '', onWatch, warm = false }: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [started, setStarted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [error, setError] = useState(false);
  const [muted, setMuted] = useState(readMuted);
  const [soundHintDismissed, setSoundHintDismissed] = useState(false);
  const [preloadMode, setPreloadMode] = useState<'auto' | 'metadata'>(active ? 'auto' : 'metadata');

  const lastTime = useRef(0);
  const played = useRef(0);
  const completed = useRef(false);
  const rewatched = useRef(false);
  const endedOnce = useRef(false);
  const wasActive = useRef(false);
  const autoRetried = useRef(false);
  const autoMuted = useRef(false);
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
    video.volume = PLAYBACK_VOLUME;
    video.muted = muted;
  }, [muted]);

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
        // The browser refused to start a clip with sound before the visitor has
        // touched the page. Mute just this playback so it still starts, but do
        // not remember the mute: the next tap turns the sound back on.
        autoMuted.current = true;
        video.muted = true;
        setMuted(true);
        video.play().catch(() => {});
      });
    }
  }, [active]);

  // Sound is the default, so the first deliberate tap or key press lifts the
  // temporary mute the browser forced on us and carries on with audio.
  useEffect(() => {
    if (!active) return;
    const unlock = () => {
      if (!autoMuted.current) return;
      autoMuted.current = false;
      const video = videoRef.current;
      if (!video) return;
      video.muted = false;
      setMuted(false);
      video.play().catch(() => {});
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
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
    // A dropped range is usually a busier moment at the database, not a bad
    // file, so the first failure reconnects quietly before telling anyone.
    const handleError = () => {
      if (wasActive.current && !autoRetried.current) {
        autoRetried.current = true;
        setWaiting(true);
        window.setTimeout(() => {
          if (!videoRef.current) return;
          videoRef.current.load();
          videoRef.current.play().catch(() => {});
        }, 400);
        return;
      }
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

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    applyMuted(next);
  };

  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div className={`feed-stage ${className}`} data-state={playing ? 'playing' : 'paused'}>
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

      {/* One line under the clip: where you are in it, and a way to silence it.
          Tapping the picture already plays and pauses, so a second play button
          and a volume slider were only clutter. */}
      <div className="stage-controls">
        <button
          type="button"
          className="stage-controls__btn"
          onClick={toggleMute}
          aria-label={muted ? 'Unmute' : 'Mute'}
        >
          <Icon name={muted ? 'mute' : 'volume'} size={17} />
        </button>
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
      </div>
    </div>
  );
}

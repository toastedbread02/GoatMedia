import { useEffect, useRef, useState } from 'react';
import type { SoundRef } from '../../shared/types.ts';
import { useAuthorizedMedia } from '../lib/media.ts';
import { formatDuration } from '../lib/format.ts';
import { Icon } from './Icon.tsx';

interface SoundStripProps {
  sound: SoundRef;
  /** Pending sounds are private, so fetch them with the session token. */
  gated?: boolean;
}

/**
 * Plays the audio attached to a photo album. It loops so a reviewer keeps
 * hearing it while stepping through the photos.
 */
export function SoundStrip({ sound, gated = false }: SoundStripProps) {
  const { src, error } = useAuthorizedMedia(sound.url, gated);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(sound.durationMs / 1000);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const node = audio.current;
    if (!node || !src) return;
    node.play().catch(() => setBlocked(true));
  }, [src]);

  const toggle = () => {
    const node = audio.current;
    if (!node) return;
    setBlocked(false);
    if (node.paused) {
      node.play().catch(() => setBlocked(true));
    } else {
      node.pause();
    }
  };

  const toggleMute = () => {
    const node = audio.current;
    if (!node) return;
    node.muted = !muted;
    setMuted(!muted);
  };

  const progress = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;

  return (
    <div className="sound-strip">
      {src ? (
        <audio
          ref={audio}
          src={src}
          preload="auto"
          loop
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) => {
            const value = event.currentTarget.duration;
            if (Number.isFinite(value) && value > 0) setDuration(value);
          }}
        />
      ) : null}

      <button
        type="button"
        className="stage-controls__btn"
        onClick={toggle}
        disabled={!src}
        aria-label={playing ? 'Pause sound' : 'Play sound'}
      >
        <Icon name={playing ? 'pause' : 'play'} size={16} filled strokeWidth={0} />
      </button>

      <div className="sound-strip__meta">
        <span className="sound-strip__title">{sound.title}</span>
        <span className="sound-strip__owner">@{sound.owner.username}</span>
      </div>

      {error ? (
        <span className="sound-strip__note">Sound did not load</span>
      ) : !src ? (
        <span className="sound-strip__note" role="status">
          Loading sound…
        </span>
      ) : blocked ? (
        <span className="sound-strip__note">Press play to hear the sound</span>
      ) : (
        <>
          <span className="stage-time tabular">
            {formatDuration(time)} / {formatDuration(duration)}
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
              value={time}
              aria-label="Seek sound"
              onChange={(event) => {
                const next = Number(event.target.value);
                if (audio.current) audio.current.currentTime = next;
                setTime(next);
              }}
            />
            <span className="seekwrap__knob" style={{ left: `${progress}%` }} />
          </div>
          <button
            type="button"
            className="stage-controls__btn"
            onClick={toggleMute}
            aria-label={muted ? 'Unmute sound' : 'Mute sound'}
          >
            <Icon name={muted ? 'mute' : 'volume'} size={16} />
          </button>
        </>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SoundRef } from '../../shared/types.ts';
import { useAuthorizedMedia } from '../lib/media.ts';
import { Icon } from './Icon.tsx';

/** Matches the player so "sound on" is one preference across the app. */
const MUTE_KEY = 'goatmedia:muted';

function soundPreferenceOn() {
  return localStorage.getItem(MUTE_KEY) === '0';
}

interface SoundCreditProps {
  sound: SoundRef;
  /** Posts out of view stay quiet; only the one on screen may play. */
  active?: boolean;
  /** Pending posts carry private audio, so fetch it with the session token. */
  gated?: boolean;
  className?: string;
}

/**
 * The audio attached to a photo album, shown with the creator it came from.
 * It stays silent until the viewer asks for sound, then plays whenever the
 * post is on screen.
 */
export function SoundCredit({ sound, active = true, gated = false, className = '' }: SoundCreditProps) {
  const { src } = useAuthorizedMedia(sound.url, gated);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const node = audio.current;
    if (!node) return;
    if (!active) {
      node.pause();
      return;
    }
    if (!soundPreferenceOn()) return;
    node.play().catch(() => {
      /* the browser wants a click first; the button is right there */
    });
  }, [active, src]);

  const toggle = () => {
    const node = audio.current;
    if (!node) return;
    if (node.paused) {
      localStorage.setItem(MUTE_KEY, '0');
      node.play().catch(() => setUnavailable(true));
    } else {
      node.pause();
    }
  };

  return (
    <div className={`sound-credit${playing ? ' is-playing' : ''} ${className}`}>
      {src ? (
        <audio
          ref={audio}
          src={src}
          preload="none"
          loop
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={() => setUnavailable(true)}
        />
      ) : null}
      <button
        type="button"
        className="sound-credit__play"
        onClick={toggle}
        disabled={!src || unavailable}
        aria-label={unavailable ? 'Sound unavailable' : playing ? 'Pause sound' : `Play sound, ${sound.title}`}
      >
        <Icon name={playing ? 'pause' : 'play'} size={12} filled strokeWidth={0} />
      </button>
      <span className="sound-credit__title">{unavailable ? 'Sound unavailable' : sound.title}</span>
      <Link className="sound-credit__owner" to={`/u/${sound.owner.username}`}>
        @{sound.owner.username}
      </Link>
    </div>
  );
}

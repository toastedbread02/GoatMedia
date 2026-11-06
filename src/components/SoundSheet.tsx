import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SoundRef } from '../../shared/types';
import { duration, plural } from '../lib/format';
import { Icon } from './Icon';

interface SoundSheetProps {
  sound: SoundRef;
  onClose: () => void;
  mode?: 'details' | 'choose';
  onChoose?: (sound: SoundRef) => void;
}

export function SoundSheet({ sound, onClose, mode = 'details', onChoose }: SoundSheetProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
      audio.current?.pause();
    };
  }, [onClose]);

  const togglePreview = () => {
    if (!audio.current) {
      audio.current = new Audio(sound.url);
      audio.current.loop = true;
      audio.current.onended = () => setPlaying(false);
    }
    if (playing) {
      audio.current.pause();
      setPlaying(false);
    } else {
      void audio.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  };

  return (
    <div className="sheet-backdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`Sound: ${sound.title}`}>
        <div className="sheet__head">
          <div>
            <p className="sheet__overline">Sound</p>
            <h2 className="sheet__title">{sound.title}</h2>
            <p className="sheet__sub">
              by @{sound.owner.username} · {duration(sound.durationMs)} ·{' '}
              {plural(sound.useCount, 'post', 'posts')}
            </p>
          </div>
          <button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="sheet__actions">
          <button type="button" className="button button--quiet" onClick={togglePreview}>
            <Icon name={playing ? 'mute' : 'play'} size={17} />
            {playing ? 'Stop preview' : 'Preview'}
          </button>
          {mode === 'details' ? (
            <button
              type="button"
              className="button"
              onClick={() => {
                onClose();
                navigate(`/upload?sound=${sound.id}`);
              }}
            >
              Use this sound
            </button>
          ) : (
            <button type="button" className="button" onClick={() => onChoose?.(sound)}>
              Choose
            </button>
          )}
        </div>
        <p className="sheet__note">
          Sounds are shared. Anyone can post their own photos with this audio, and the creator keeps
          the credit.
        </p>
      </div>
    </div>
  );
}

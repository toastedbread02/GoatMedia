import { useCallback, useEffect, useRef, useState } from 'react';
import type { PhotoRef } from '../../shared/types.ts';
import { Icon } from './Icon.tsx';
import { useAuthorizedMedia } from '../lib/media.ts';

interface PhotoAlbumProps {
  photos: PhotoRef[];
  caption: string;
  className?: string;
  eager?: boolean;
  /** Pending, rejected or removed posts need the session token to load. */
  gated?: boolean;
}

function Slide({
  photo,
  caption,
  eager,
  gated,
}: {
  photo: PhotoRef;
  caption: string;
  eager: boolean;
  gated: boolean;
}) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const { src, error } = useAuthorizedMedia(photo.url, gated, attempt);
  const broken = failed || Boolean(error);

  if (broken) {
    return (
      <div className="album__failed">
        <Icon name="alert" size={20} />
        <p>This photo did not load.</p>
        <button
          type="button"
          className="btn btn--quiet btn--sm"
          onClick={() => {
            setFailed(false);
            setAttempt((current) => current + 1);
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  if (!src) {
    return (
      <div className="album__failed" role="status" aria-label="Loading photo">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={caption || 'Goat photo'}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

/**
 * Photos move sideways with scroll-snap, so a vertical swipe still belongs to
 * the feed and a horizontal one turns the page. One photo renders as a plain
 * image with no controls at all.
 */
export function PhotoAlbum({
  photos,
  caption,
  className = '',
  eager = false,
  gated = false,
}: PhotoAlbumProps) {
  const track = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);
  const wheelDelta = useRef(0);
  const wheelResetTimer = useRef(0);
  const stepLockUntil = useRef(0);
  const multiple = photos.length > 1;

  const goTo = useCallback(
    (next: number) => {
      const node = track.current;
      if (!node) return;
      const clamped = Math.max(0, Math.min(photos.length - 1, next));
      node.scrollTo({ left: clamped * node.clientWidth, behavior: 'smooth' });
      setIndex(clamped);
    },
    [photos.length],
  );

  useEffect(() => {
    const node = track.current;
    if (!node) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!node.clientWidth) return;
        const next = Math.round(node.scrollLeft / node.clientWidth);
        setIndex((current) => (current === next ? current : next));
      });
    };
    node.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      node.removeEventListener('scroll', onScroll);
    };
  }, []);

  // A trackpad flick can cross several photos before snap catches it. A
  // horizontal gesture moves exactly one photo, and the momentum after it is
  // spent rather than repeated.
  useEffect(() => {
    const node = track.current;
    if (!node || !multiple) return;

    const step = (direction: 1 | -1) => {
      const width = node.clientWidth;
      if (!width) return;
      const current = Math.max(0, Math.min(photos.length - 1, Math.round(node.scrollLeft / width)));
      const next = Math.max(0, Math.min(photos.length - 1, current + direction));
      if (next === current) return;
      stepLockUntil.current = performance.now() + 320;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      node.scrollTo({ left: next * width, behavior: reduced ? 'auto' : 'smooth' });
    };

    const onWheel = (event: WheelEvent) => {
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      // Vertical input belongs to the feed; shift-wheel is how a mouse scrolls
      // sideways, so both count as turning the page.
      if (!horizontal && !event.shiftKey) return;
      if (node.scrollWidth <= node.clientWidth + 1) return;
      event.preventDefault();
      if (performance.now() < stepLockUntil.current) return;

      const width = node.clientWidth || 1;
      const raw = horizontal ? event.deltaX : event.deltaY;
      const delta =
        event.deltaMode === 1 ? raw * 16 : event.deltaMode === 2 ? raw * width : raw;
      wheelDelta.current += delta;
      window.clearTimeout(wheelResetTimer.current);
      wheelResetTimer.current = window.setTimeout(() => {
        wheelDelta.current = 0;
      }, 150);
      if (Math.abs(wheelDelta.current) < 24) return;
      const direction = wheelDelta.current > 0 ? 1 : -1;
      wheelDelta.current = 0;
      step(direction);
    };

    node.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      node.removeEventListener('wheel', onWheel);
      window.clearTimeout(wheelResetTimer.current);
    };
  }, [multiple, photos.length]);

  return (
    <div
      className={`album ${multiple ? 'album--multi' : ''} ${className}`}
      onKeyDown={(event) => {
        if (!multiple) return;
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          goTo(index + 1);
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          goTo(index - 1);
        }
      }}
    >
      <div
        className="album__track"
        ref={track}
        tabIndex={multiple ? 0 : -1}
        role={multiple ? 'group' : 'img'}
        aria-label={
          multiple
            ? `Photos, ${index + 1} of ${photos.length}: ${caption || 'goat post'}`
            : caption || 'Goat photo'
        }
      >
        {photos.map((photo, position) => (
          <figure className="album__slide" key={photo.id}>
            <Slide photo={photo} caption={caption} eager={eager && position === 0} gated={gated} />
          </figure>
        ))}
      </div>

      {multiple ? (
        <>
          <button
            type="button"
            className="album__arrow album__arrow--prev"
            aria-label="Previous photo"
            onClick={() => goTo(index - 1)}
            disabled={index === 0}
          >
            <Icon name="chevron-left" size={18} />
          </button>
          <button
            type="button"
            className="album__arrow album__arrow--next"
            aria-label="Next photo"
            onClick={() => goTo(index + 1)}
            disabled={index === photos.length - 1}
          >
            <Icon name="chevron-right" size={18} />
          </button>
          <div className="album__dots" role="tablist" aria-label="Choose a photo">
            {photos.map((photo, position) => (
              <button
                key={photo.id}
                type="button"
                role="tab"
                aria-selected={position === index}
                aria-label={`Photo ${position + 1}`}
                className={`album__dot${position === index ? ' is-active' : ''}`}
                onClick={() => goTo(position)}
              />
            ))}
          </div>
          <span className="album__counter" aria-hidden="true">
            {index + 1}/{photos.length}
          </span>
        </>
      ) : null}
    </div>
  );
}

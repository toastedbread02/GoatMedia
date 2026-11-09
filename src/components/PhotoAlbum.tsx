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
  /**
   * Called on a double tap. A photo has no single-tap action, so the second tap
   * can like straight away instead of waiting out a window the way a video's
   * tap has to.
   */
  onDoubleTap?: () => void;
}

/** Two taps closer together than this, on the same photo, are one double tap. */
const DOUBLE_TAP_MS = 280;

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

  // Switching loading to eager is only a hint; fetch the neighbouring photo
  // explicitly so the next turn never waits on the network.
  useEffect(() => {
    if (!eager || !src) return;
    const preload = new Image();
    preload.decoding = 'async';
    preload.src = src;
  }, [eager, src]);

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
  onDoubleTap,
}: PhotoAlbumProps) {
  const track = useRef<HTMLDivElement | null>(null);
  const burstLayer = useRef<HTMLDivElement | null>(null);
  const [bursts, setBursts] = useState<{ id: number; x: number; y: number }[]>([]);
  const burstTimers = useRef<number[]>([]);
  const lastTap = useRef<{ time: number; scroll: number } | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const [index, setIndex] = useState(0);
  const wheelDelta = useRef(0);
  const wheelResetTimer = useRef(0);
  // One gesture turns one page; the latch only releases after the wheel idles.
  const gestureUsed = useRef(false);
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
    return () => {
      burstTimers.current.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  // Double tap to like. Turning a page is a drag or a wheel gesture, never a
  // tap, so both are kept out: a swipe that ends on the photo still fires a
  // click, and two quick swipes must not read as one double tap.
  const handleTap = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!onDoubleTap) return;
    // A click raised from the keyboard carries no pointer position.
    if (event.detail === 0) return;
    const start = pressStart.current;
    pressStart.current = null;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) {
      lastTap.current = null;
      return;
    }
    const scrollLeft = track.current ? track.current.scrollLeft : 0;
    const now = Date.now();
    const previous = lastTap.current;
    if (
      previous &&
      now - previous.time <= DOUBLE_TAP_MS &&
      Math.abs(previous.scroll - scrollLeft) < 2
    ) {
      lastTap.current = null;
      const layer = burstLayer.current;
      const rect = (layer ?? event.currentTarget).getBoundingClientRect();
      const id = Date.now() + Math.random();
      setBursts((current) => [...current, { id, x: event.clientX - rect.left, y: event.clientY - rect.top }]);
      burstTimers.current.push(
        window.setTimeout(() => {
          setBursts((current) => current.filter((burst) => burst.id !== id));
        }, 820),
      );
      onDoubleTap();
      return;
    }
    lastTap.current = { time: now, scroll: scrollLeft };
  };

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

      window.clearTimeout(wheelResetTimer.current);
      wheelResetTimer.current = window.setTimeout(() => {
        gestureUsed.current = false;
        wheelDelta.current = 0;
      }, 300);
      if (gestureUsed.current) return;

      const width = node.clientWidth || 1;
      const raw = horizontal ? event.deltaX : event.deltaY;
      const delta =
        event.deltaMode === 1 ? raw * 16 : event.deltaMode === 2 ? raw * width : raw;
      wheelDelta.current += delta;
      if (Math.abs(wheelDelta.current) < 24) return;
      const direction = wheelDelta.current > 0 ? 1 : -1;
      gestureUsed.current = true;
      wheelDelta.current = 0;
      step(direction);
    };

    node.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      node.removeEventListener('wheel', onWheel);
      window.clearTimeout(wheelResetTimer.current);
      gestureUsed.current = false;
    };
  }, [multiple, photos.length]);

  return (
    <div
      className={`album ${multiple ? 'album--multi' : ''} ${className}`}
      onKeyDown={(event) => {
        if (!multiple || event.repeat) return;
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
        onPointerDown={(event) => {
          pressStart.current = { x: event.clientX, y: event.clientY };
        }}
        onClick={handleTap}
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
            {/* The photo on either side of this one loads ahead so a turn is
                instant; anything further away waits until it is needed. */}
            <Slide
              photo={photo}
              caption={caption}
              eager={eager && Math.abs(position - index) <= 1}
              gated={gated}
            />
          </figure>
        ))}
      </div>

      {/* Above the photos and outside the scrolling track, so a heart lands
          where the finger did and stays put instead of sliding away. */}
      <div className="album__bursts" ref={burstLayer} aria-hidden="true">
        {bursts.map((burst) => (
          <span key={burst.id} className="stage-burst" style={{ left: burst.x, top: burst.y }}>
            <Icon name="heart" size={92} filled />
          </span>
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

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PhotoRef } from '../../shared/types.ts';
import { Icon } from './Icon.tsx';

interface PhotoAlbumProps {
  photos: PhotoRef[];
  caption: string;
  className?: string;
  eager?: boolean;
}

/**
 * Photos move sideways with scroll-snap, so a vertical swipe still belongs to
 * the feed and a horizontal one turns the page. One photo renders as a plain
 * image with no controls at all.
 */
export function PhotoAlbum({ photos, caption, className = '', eager = false }: PhotoAlbumProps) {
  const track = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
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
            {failed[photo.id] ? (
              <div className="album__failed">
                <Icon name="alert" size={20} />
                <p>This photo did not load.</p>
                <button
                  type="button"
                  className="btn btn--quiet btn--sm"
                  onClick={() => setFailed((current) => ({ ...current, [photo.id]: false }))}
                >
                  Try again
                </button>
              </div>
            ) : (
              <img
                src={photo.url}
                alt={caption || 'Goat photo'}
                loading={eager && position === 0 ? 'eager' : 'lazy'}
                decoding="async"
                draggable={false}
                onError={() => setFailed((current) => ({ ...current, [photo.id]: true }))}
              />
            )}
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

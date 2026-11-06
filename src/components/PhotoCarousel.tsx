import { useCallback, useEffect, useRef, useState } from 'react';
import type { PhotoRef } from '../../shared/types';
import { Icon } from './Icon';

interface PhotoCarouselProps {
  photos: PhotoRef[];
  caption: string;
  eager?: boolean;
  className?: string;
}

/**
 * Photos scroll sideways with scroll-snap, so the gesture inside the carousel
 * belongs to the carousel and the page keeps its normal vertical scroll.
 */
export function PhotoCarousel({ photos, caption, eager = false, className = '' }: PhotoCarouselProps) {
  const track = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
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
      className={`carousel ${multiple ? 'carousel--multi' : ''} ${className}`}
      data-index={index}
      onKeyDown={(event) => {
        if (!multiple) return;
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          goTo(index + 1);
        }
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          goTo(index - 1);
        }
      }}
    >
      <div
        className="carousel__track"
        ref={track}
        tabIndex={multiple ? 0 : -1}
        role={multiple ? 'group' : 'img'}
        aria-label={
          multiple ? `Photos, ${index + 1} of ${photos.length}: ${caption || 'goat post'}` : caption || 'Goat photo'
        }
      >
        {photos.map((photo, position) => (
          <figure className="carousel__slide" key={photo.id}>
            {!loaded[photo.id] && !failed[photo.id] ? (
              <div className="photo-skeleton" aria-hidden="true" />
            ) : null}
            {failed[photo.id] ? (
              <div className="photo-failed">
                <Icon name="alert" size={22} />
                <p>This photo did not load.</p>
                <button
                  type="button"
                  className="button button--quiet"
                  onClick={() => {
                    setFailed((current) => ({ ...current, [photo.id]: false }));
                  }}
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
                className={loaded[photo.id] ? 'is-loaded' : ''}
                onLoad={() => setLoaded((current) => ({ ...current, [photo.id]: true }))}
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
            className="carousel__arrow carousel__arrow--prev"
            aria-label="Previous photo"
            onClick={() => goTo(index - 1)}
            disabled={index === 0}
          >
            <Icon name="chevron-left" size={19} />
          </button>
          <button
            type="button"
            className="carousel__arrow carousel__arrow--next"
            aria-label="Next photo"
            onClick={() => goTo(index + 1)}
            disabled={index === photos.length - 1}
          >
            <Icon name="chevron-right" size={19} />
          </button>
          <div className="carousel__dots" role="tablist" aria-label="Choose a photo">
            {photos.map((photo, position) => (
              <button
                key={photo.id}
                type="button"
                role="tab"
                aria-selected={position === index}
                aria-label={`Photo ${position + 1}`}
                className={`carousel__dot ${position === index ? 'is-active' : ''}`}
                onClick={() => goTo(position)}
              />
            ))}
          </div>
          <span className="carousel__counter" aria-hidden="true">
            {index + 1}/{photos.length}
          </span>
        </>
      ) : null}
    </div>
  );
}

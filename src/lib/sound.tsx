import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface SoundValue {
  enabled: boolean;
  blocked: boolean;
  activeId: string | null;
  toggle: () => void;
  claim: (id: string, url: string) => void;
  release: (id: string) => void;
}

const SoundContext = createContext<SoundValue | null>(null);
const PREF_KEY = 'goatmedia.sound';

/**
 * One audio element for the whole app. Browsers only allow playback after a
 * gesture, so audio starts muted-by-choice: the first tap on a sound button
 * turns it on for every post from then on.
 */
export function SoundProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem(PREF_KEY) === 'on';
    } catch {
      return false;
    }
  });
  const [blocked, setBlocked] = useState(false);
  const [active, setActive] = useState<{ id: string; url: string } | null>(null);

  if (!audioRef.current && typeof Audio !== 'undefined') {
    const audio = new Audio();
    audio.loop = true;
    audio.preload = 'none';
    audio.volume = 0.7;
    audioRef.current = audio;
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!enabled || !active) {
      audio.pause();
      return;
    }
    if (!audio.src.endsWith(active.url)) {
      audio.src = active.url;
    }
    const promise = audio.play();
    if (promise) {
      promise.then(() => setBlocked(false)).catch(() => setBlocked(true));
    }
  }, [enabled, active]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  const toggle = useCallback(() => {
    setEnabled((current) => {
      const next = !current;
      try {
        localStorage.setItem(PREF_KEY, next ? 'on' : 'off');
      } catch {
        /* ignore */
      }
      if (next) setBlocked(false);
      return next;
    });
  }, []);

  const claim = useCallback((id: string, url: string) => {
    setActive((current) => (current && current.id === id && current.url === url ? current : { id, url }));
  }, []);

  const release = useCallback((id: string) => {
    setActive((current) => (current && current.id === id ? null : current));
  }, []);

  return (
    <SoundContext.Provider value={{ enabled, blocked, activeId: active?.id ?? null, toggle, claim, release }}>
      {children}
    </SoundContext.Provider>
  );
}

export function useSound(): SoundValue {
  const value = useContext(SoundContext);
  if (!value) throw new Error('Sound is not ready yet.');
  return value;
}

/** Lets a post own the audio while it is the post you are looking at. */
export function useSoundClaim(postId: string, url: string | null) {
  const { claim, release } = useSound();
  const ref = useRef<HTMLElement | null>(null);
  const visible = useRef(false);

  useEffect(() => {
    if (!url) return;
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            visible.current = true;
            claim(postId, url);
          } else if (entry.intersectionRatio < 0.3 && visible.current) {
            visible.current = false;
            release(postId);
          }
        }
      },
      { threshold: [0, 0.3, 0.6, 0.9] },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      release(postId);
    };
  }, [postId, url, claim, release]);

  return ref;
}

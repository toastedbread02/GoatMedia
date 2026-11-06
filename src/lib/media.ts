import { useEffect, useState } from 'react';
import { fetchMediaObjectUrl } from './api.ts';

interface MediaState {
  src: string | null;
  error: string | null;
}

/**
 * Resolves a media URL the browser can render. Public media is used directly;
 * gated media (pending, rejected or removed posts) is fetched with the session
 * token and turned into an object URL, then revoked when it is no longer needed.
 */
export function useAuthorizedMedia(url: string | null, gated: boolean, attempt = 0): MediaState {
  const [state, setState] = useState<MediaState>({ src: gated ? null : url, error: null });

  useEffect(() => {
    if (!url) {
      setState({ src: null, error: null });
      return;
    }
    if (!gated) {
      setState({ src: url, error: null });
      return;
    }

    let cancelled = false;
    let created: string | null = null;
    setState({ src: null, error: null });

    fetchMediaObjectUrl(url)
      .then((objectUrl) => {
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        created = objectUrl;
        setState({ src: objectUrl, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          src: null,
          error: error instanceof Error ? error.message : 'That video could not be loaded.',
        });
      });

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [url, gated, attempt]);

  return state;
}

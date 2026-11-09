import { useEffect, useState } from 'react';
import type { InterestCatalogDTO } from '../../shared/types.ts';
import { api } from '../lib/api.ts';

interface InterestPickerProps {
  /** Dismissed without choosing; the feed stays as it was. */
  onSkip: () => void;
  /** Saved a choice; the feed can be reloaded with the new weights. */
  onSaved: () => void;
}

function toggleIn(list: string[], value: string) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/**
 * A cold For You is the worst first minute on the site. This asks once, using
 * the same interest weights the recommender already reads, so a new account
 * starts somewhere instead of nowhere.
 */
export function InterestPicker({ onSkip, onSaved }: InterestPickerProps) {
  const [catalog, setCatalog] = useState<InterestCatalogDTO | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<InterestCatalogDTO>('/api/interests')
      .then((data) => {
        if (!cancelled) setCatalog(data);
      })
      .catch(() => {
        if (!cancelled) setError('The list of interests could not load.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const total = categories.length + hashtags.length;

  const save = async () => {
    if (!total) {
      setError('Pick at least one thing.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.post('/api/me/interests/seed', { categories, hashtags });
      onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'That did not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className="interest-picker"
      role="region"
      aria-labelledby="interest-picker-title"
      aria-label="Choose your interests"
    >
      <div className="interest-picker__card">
        <h2 id="interest-picker-title">What are you into?</h2>
        <p className="interest-picker__sub">
          Pick a few things and For You starts closer to what you like. Settings can change it
          later.
        </p>

        {catalog === null ? (
          <p className="section-note" role="status">
            Loading…
          </p>
        ) : (
          <>
            <h3 className="interest-group__title">Kinds of goats</h3>
            <div className="chips">
              {catalog.categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className={`chip${categories.includes(category.id) ? ' is-on' : ''}`}
                  aria-pressed={categories.includes(category.id)}
                  onClick={() => setCategories((current) => toggleIn(current, category.id))}
                >
                  {category.label}
                </button>
              ))}
            </div>

            {catalog.hashtags.length ? (
              <>
                <h3 className="interest-group__title">Topics</h3>
                <div className="chips">
                  {catalog.hashtags.map((item) => (
                    <button
                      key={item.tag}
                      type="button"
                      className={`chip${hashtags.includes(item.tag) ? ' is-on' : ''}`}
                      aria-pressed={hashtags.includes(item.tag)}
                      onClick={() => setHashtags((current) => toggleIn(current, item.tag))}
                    >
                      #{item.tag}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </>
        )}

        {error ? <p className="field__error">{error}</p> : null}

        <div className="form-actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={save}
            disabled={saving || total === 0}
          >
            {saving ? 'Saving…' : 'Start my feed'}
          </button>
          <button type="button" className="btn btn--quiet" onClick={onSkip}>
            Not now
          </button>
        </div>
      </div>
    </section>
  );
}

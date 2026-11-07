import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PublicUser } from '../../shared/types.ts';
import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useToast } from '../lib/toast.tsx';
import { compactNumber } from '../lib/format.ts';
import { Avatar } from './Avatar.tsx';

interface Props {
  limit?: number;
  title?: string;
}

/**
 * A short list of people with approved posts that the reader does not follow
 * yet. It only appears once the server has something real to suggest, so an
 * empty feed never shows a hollow placeholder.
 */
export function CreatorSuggestions({ limit = 4, title = 'Creators to follow' }: Props) {
  const { user } = useAuth();
  const { notify } = useToast();
  const [people, setPeople] = useState<PublicUser[] | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!user) {
      setPeople(null);
      return;
    }
    let cancelled = false;
    api
      .get<{ users: PublicUser[] }>(`/api/me/suggestions?limit=${limit}`)
      .then((data) => {
        if (!cancelled) setPeople(data.users);
      })
      .catch(() => {
        if (!cancelled) setPeople([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user, limit]);

  if (!user || !people || people.length === 0) return null;

  const follow = async (person: PublicUser) => {
    setPending((current) => ({ ...current, [person.id]: true }));
    try {
      await api.post(`/api/users/${person.username}/follow`);
      setPeople((list) =>
        (list || []).map((item) => (item.id === person.id ? { ...item, isFollowing: true } : item)),
      );
      notify(`Following @${person.username}.`);
    } catch {
      notify('Could not follow them. Try again.', { tone: 'error' });
    } finally {
      setPending((current) => ({ ...current, [person.id]: false }));
    }
  };

  return (
    <section className="suggest" aria-label={title}>
      <h2 className="suggest__title">{title}</h2>
      <ul className="suggest__list">
        {people.map((person) => (
          <li key={person.id} className="suggest__row">
            <Link to={`/u/${person.username}`} className="suggest__person">
              <Avatar
                displayName={person.displayName}
                username={person.username}
                avatarUrl={person.avatarUrl}
                size={36}
              />
              <span className="suggest__text">
                <span className="suggest__name">{person.displayName}</span>
                <span className="suggest__handle">
                  @{person.username}
                  {person.followerCount ? ` · ${compactNumber(person.followerCount)} followers` : ''}
                </span>
              </span>
            </Link>
            <button
              type="button"
              className="btn btn--sm btn--quiet suggest__follow"
              onClick={() => follow(person)}
              disabled={pending[person.id] || person.isFollowing}
              aria-pressed={person.isFollowing}
            >
              {person.isFollowing ? 'Following' : 'Follow'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

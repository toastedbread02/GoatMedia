import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { PostDTO } from '../../shared/types';
import { CommentsPanel } from '../components/CommentsPanel';
import { Icon } from '../components/Icon';
import { PostCard } from '../components/PostCard';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

export function PostPage() {
  const { id = '' } = useParams();
  const { me } = useAuth();
  const navigate = useNavigate();
  const [post, setPost] = useState<PostDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .post(id)
      .then((result) => {
        if (!cancelled) setPost(result.post);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="column">
        <div className="post-skeleton" aria-busy="true">
          <div className="post-skeleton__head" />
          <div className="post-skeleton__media" />
        </div>
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="column">
        <div className="empty">
          <Icon name="alert" size={26} />
          <p className="empty__title">This post is not available</p>
          <p>{error || 'It may have been removed, or it is still waiting for review.'}</p>
          <Link to="/" className="button">
            Back to the feed
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="column column--reading">
      <button type="button" className="back-link" onClick={() => navigate(-1)}>
        <Icon name="arrow-left" size={17} />
        Back
      </button>
      <PostCard
        post={post}
        priority
        showStatus={post.creator.isSelf || me?.role === 'admin'}
        onUpdate={(patch) => setPost((current) => (current ? { ...current, ...patch } : current))}
        onRemove={() => navigate('/')}
      />
      {post.status === 'approved' ? <CommentsPanel post={post} inline /> : null}
    </div>
  );
}

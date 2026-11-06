import type { PostStatus } from '../../shared/types';

const labels: Record<PostStatus, string> = {
  pending: 'Waiting for review',
  approved: 'Live',
  rejected: 'Not approved',
  removed: 'Removed',
};

export function StatusBadge({ status }: { status: PostStatus }) {
  return (
    <span className={`status status--${status}`}>
      <span className="status__dot" aria-hidden="true" />
      {labels[status]}
    </span>
  );
}

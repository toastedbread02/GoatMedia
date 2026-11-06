import type { VideoStatus } from '../../shared/types.ts';

const LABEL: Record<VideoStatus, string> = {
  pending: 'In review',
  approved: 'Published',
  rejected: 'Not approved',
  removed: 'Removed',
};

export function StatusTag({ status, className = '' }: { status: VideoStatus; className?: string }) {
  return (
    <span className={`status-tag status-tag--${status} ${className}`}>
      <span className="status-tag__dot" aria-hidden="true" />
      {LABEL[status]}
    </span>
  );
}

import { useDocumentTitle } from '../lib/hooks.ts';

/**
 * The page behind the odd account: no header, no navigation, no content. It
 * sits above the shell as a fixed white sheet so nothing of the site shows
 * through, and leaves only the one character that account uses everywhere else.
 */
export function OddProfile() {
  useDocumentTitle('?');
  return (
    <div className="odd-profile" role="img" aria-label="?">
      <span aria-hidden="true">?</span>
    </div>
  );
}

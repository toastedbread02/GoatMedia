import { useEffect } from 'react';
import type { ArgTrace } from '../lib/easterEgg.ts';

/**
 * Leaves a mark for whoever opens the elements panel: a hidden node in the
 * markup, a comment node next to it, a meta tag, and one line in the console.
 * Nothing here is visible on the page itself.
 */
export function ArgTraceMark({ trace }: { trace: ArgTrace }) {
  useEffect(() => {
    const line = `${trace.label} · ${trace.note}`;

    const comment = document.createComment(` ${line} `);
    document.body.appendChild(comment);

    const meta = document.createElement('meta');
    meta.name = 'x-goatmedia';
    meta.content = line;
    document.head.appendChild(meta);

    // eslint-disable-next-line no-console
    console.log(`%c${trace.label}`, 'color:#8a8578;font-size:10px;letter-spacing:.18em', trace.note);

    return () => {
      comment.remove();
      meta.remove();
    };
  }, [trace.label, trace.note]);

  return (
    <span className="arg-hidden" aria-hidden="true">
      {trace.label} {trace.note}
    </span>
  );
}

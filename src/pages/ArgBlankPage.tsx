import { useState } from 'react';
import { markDayTenOpen } from '../lib/argDeep.ts';
import { useDocumentTitle } from '../lib/hooks.ts';

const TAPS = 5;

/**
 * A white page with the wordmark on it. Nothing else: no feed, no navigation,
 * no way back except the browser's own button.
 *
 * Five taps on the wordmark and it says what it is. That is also the moment day
 * 10 decides its comments can be written on.
 */
export function ArgBlankPage() {
  useDocumentTitle('GoatMedia');
  const [taps, setTaps] = useState(0);
  const [done, setDone] = useState(false);

  const tap = () => {
    if (done) return;
    const next = taps + 1;
    setTaps(next);
    if (next < TAPS) return;
    setDone(true);
    markDayTenOpen();
  };

  return (
    <div className="arg-blank">
      <button type="button" className="arg-blank__logo" onClick={tap}>
        GoatMedia
      </button>
      {done ? <p className="arg-blank__dead">dead end</p> : null}
    </div>
  );
}

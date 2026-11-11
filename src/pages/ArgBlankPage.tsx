import { useEffect, useState } from 'react';
import { markDayTenOpen } from '../lib/argDeep.ts';
import { LogoMark } from '../components/Logo.tsx';
import { useDocumentTitle } from '../lib/hooks.ts';

const TAPS = 5;

/**
 * A white page with the site's mark on it. Nothing else: no feed, no
 * navigation, no way back except the browser's own button.
 *
 * Five taps on the mark and it says what it is. That is also the moment day 10
 * decides its comments can be written on.
 */
export function ArgBlankPage() {
  useDocumentTitle('GoatMedia');
  const [taps, setTaps] = useState(0);
  const [done, setDone] = useState(false);

  // Counted from the previous value, so taps that land in the same tick still
  // add up: five quick clicks have to work as well as five patient ones.
  const tap = () => {
    if (done) return;
    setTaps((current) => current + 1);
  };

  useEffect(() => {
    if (taps < TAPS || done) return;
    setDone(true);
    markDayTenOpen();
  }, [taps, done]);

  return (
    <div className="arg-blank">
      <button type="button" className="arg-blank__logo" onClick={tap} aria-label="GoatMedia">
        <LogoMark size={64} />
      </button>
      {done ? <p className="arg-blank__dead">dead end</p> : null}
    </div>
  );
}

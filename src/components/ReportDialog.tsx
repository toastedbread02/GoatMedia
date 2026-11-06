import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useConfig } from '../lib/config';
import { useToast } from '../lib/toast';
import { Icon } from './Icon';

export type ReportTarget = { type: 'post' | 'comment' | 'user'; id: string; label?: string };

interface ReportDialogProps {
  target: ReportTarget;
  onClose: () => void;
}

export function ReportDialog({ target, onClose }: ReportDialogProps) {
  const config = useConfig();
  const toast = useToast();
  const firstRef = useRef<HTMLButtonElement | null>(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  const reasons = target.type === 'comment' ? config.reportReasons.comment : config.reportReasons.post;

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async () => {
    if (!reason) {
      setError('Choose a reason first.');
      return;
    }
    setState('sending');
    setError(null);
    try {
      if (target.type === 'post') await api.reportPost(target.id, reason, note);
      else if (target.type === 'comment') await api.reportComment(target.id, reason, note);
      else await api.reportUser(target.id, reason, note);
      setState('done');
      toast('Report sent to the moderator', 'success');
    } catch (err) {
      setState('idle');
      setError((err as Error).message);
    }
  };

  return (
    <div className="sheet-backdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="sheet sheet--narrow" role="dialog" aria-modal="true" aria-labelledby="report-title">
        <div className="sheet__head">
          <div>
            <h2 className="sheet__title" id="report-title">
              Report {target.type === 'user' ? 'account' : target.type}
            </h2>
            <p className="sheet__sub">
              {target.label ? `“${target.label}”` : 'A person reviews every report.'}
            </p>
          </div>
          <button ref={firstRef} type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        {state === 'done' ? (
          <div className="report-done">
            <Icon name="check" size={22} />
            <p>The moderator will look at this. Thanks for flagging it.</p>
            <button type="button" className="button" onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          <>
            <fieldset className="field radio-list">
              <legend className="field__label">What is wrong?</legend>
              {reasons.map((option) => (
                <label key={option} className="radio">
                  <input
                    type="radio"
                    name="report-reason"
                    value={option}
                    checked={reason === option}
                    onChange={() => setReason(option)}
                  />
                  <span>{option}</span>
                </label>
              ))}
            </fieldset>
            <label className="field">
              <span className="field__label">Anything else? (optional)</span>
              <textarea
                className="textarea"
                rows={3}
                maxLength={400}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Context helps the moderator decide quickly."
              />
            </label>
            {error ? <p className="form-error">{error}</p> : null}
            <div className="sheet__actions">
              <button type="button" className="button button--quiet" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="button" onClick={submit} disabled={state === 'sending'}>
                {state === 'sending' ? 'Sending…' : 'Send report'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

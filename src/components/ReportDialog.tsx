import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon.tsx';

interface ReportDialogProps {
  open: boolean;
  title: string;
  subject: string;
  reasons: string[];
  onClose: () => void;
  onSubmit: (reason: string, note: string) => Promise<void>;
}

export function ReportDialog({ open, title, subject, reasons, onClose, onSubmit }: ReportDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState(reasons[0] ?? '');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setReason(reasons[0] ?? '');
      setNote('');
      setError(null);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open, reasons]);

  return (
    <dialog className="dialog" ref={dialogRef} onCancel={onClose} onClose={onClose} aria-labelledby="report-title">
      <form
        className="dialog__form"
        onSubmit={async (event) => {
          event.preventDefault();
          setSubmitting(true);
          setError(null);
          try {
            await onSubmit(reason, note);
            onClose();
          } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : 'The report did not send.');
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <div className="dialog__head">
          <h2 id="report-title">{title}</h2>
          <button type="button" className="iconbtn" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>
        <p className="dialog__subject">{subject}</p>
        <fieldset className="radio-list">
          <legend className="field__label">What is wrong?</legend>
          {reasons.map((option) => (
            <label key={option} className="radio-list__item">
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
        <div className="field">
          <label className="field__label" htmlFor="report-note">
            Anything else? (optional)
          </label>
          <textarea
            id="report-note"
            className="textarea"
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Context helps the moderator make a fair call."
          />
        </div>
        {error ? <p className="field__error">{error}</p> : null}
        <div className="dialog__actions">
          <button type="button" className="btn btn--quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={submitting}>
            {submitting ? 'Sending…' : 'Send report'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

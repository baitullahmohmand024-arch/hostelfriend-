import React, { useState } from 'react';
import { Flag, X } from 'lucide-react';
import { createReport } from '../services/socialService';
import { useToast } from '../context/ToastContext';
import { formatUserFriendlyError } from '../lib/firestoreError';
import { useModalBackHandler } from '../lib/backNavigation';

interface ReportModalProps {
  open: boolean;
  reporterId: string;
  targetType: 'post' | 'user' | 'comment';
  targetId: string;
  targetAuthorId: string;
  targetLabel: string;
  onClose: () => void;
}

const REPORT_REASONS = [
  'Harassment or bullying',
  'Hate speech or discrimination',
  'Spam or misleading content',
  'Non-consensual or private photo',
  'Inappropriate or unsafe media',
  'Impersonation',
];

export function ReportModal({
  open,
  reporterId,
  targetType,
  targetId,
  targetAuthorId,
  targetLabel,
  onClose,
}: ReportModalProps) {
  const { showToast } = useToast();
  const [reason, setReason] = useState(REPORT_REASONS[0]);
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useModalBackHandler(open, () => {
    if (!submitting) {
      onClose();
    }
  });

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await createReport({
        reporterId,
        targetType,
        targetId,
        targetAuthorId,
        reason,
        details,
      });
      showToast({
        type: 'success',
        title: 'Report submitted',
        description: 'Thank you. Our moderation team will review this carefully.',
      });
      setDetails('');
      onClose();
    } catch (err) {
      showToast({
        type: 'error',
        title: 'Unable to submit report',
        description: formatUserFriendlyError(err, 'Please try again.'),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-modal-title"
    >
      <form
        onSubmit={handleSubmit}
        className="glass-modal hf-modal-enter w-full max-w-md rounded-2xl p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Flag className="w-4 h-4 text-accent-strong" />
            <h3 id="report-modal-title" className="text-lg font-display font-semibold text-ink-2">
              Report {targetType}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close report dialog"
            className="text-ink-muted hover:text-ink-2 p-1 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="mt-2 text-xs text-ink-muted">
          Reporting: <span className="text-ink-2 font-medium">{targetLabel}</span>
        </p>

        <div className="mt-4 space-y-3">
          <label className="block text-xs font-medium text-ink-muted">
            Reason
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1.5 w-full rounded-xl bg-canvas-alt border border-hairline px-3.5 py-2.5 text-sm text-ink-2 focus:outline-none focus:border-accent-strong"
            >
              {REPORT_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs font-medium text-ink-muted">
            Additional context (optional)
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={3}
              maxLength={600}
              placeholder="Share details that help moderators evaluate this report..."
              className="mt-1.5 w-full rounded-xl bg-canvas-alt border border-hairline px-3.5 py-2.5 text-sm text-ink-2 placeholder:text-ink-subtle focus:outline-none focus:border-accent-strong resize-none"
            />
          </label>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded-xl border border-hairline text-ink-2 hover:bg-hover-tint transition-colors whitespace-nowrap shrink-0"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="gold-gradient-btn px-4 py-2 text-sm font-semibold rounded-xl transition-all whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Submit Report'}
          </button>
        </div>
      </form>
    </div>
  );
}

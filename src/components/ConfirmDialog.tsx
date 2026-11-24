import { X } from 'lucide-react';
import { useModalBackHandler } from '../lib/backNavigation';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useModalBackHandler(open, () => {
    if (!loading) {
      onCancel();
    }
  });

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="glass-modal hf-modal-enter w-full max-w-md rounded-2xl p-6">
        <div className="flex items-start justify-between gap-4">
          <h3 id="confirm-dialog-title" className="text-lg font-display font-semibold text-ink-2">
            {title}
          </h3>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close dialog"
            className="text-ink-muted hover:text-ink-2 p-1 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="mt-2.5 text-sm text-ink-muted leading-relaxed">{description}</p>
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium rounded-xl border border-hairline text-ink-2 hover:bg-hover-tint transition-colors whitespace-nowrap shrink-0"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 text-sm font-semibold rounded-xl transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 ${
              destructive
                ? 'bg-rose-600 text-white hover:bg-rose-500'
                : 'gold-gradient-btn'
            }`}
          >
            {loading ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

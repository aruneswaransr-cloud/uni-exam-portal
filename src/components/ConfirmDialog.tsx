import { type ReactNode } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger, onConfirm, onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-ink-950/40 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-md rounded-2xl border border-ink-200 bg-white p-6 shadow-xl">
        <div className="flex items-start gap-3">
          {danger && (
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-danger-500/10 text-danger-500">
              <AlertTriangle className="h-5 w-5" />
            </div>
          )}
          <div className="flex-1">
            <h3 className="font-display text-lg font-700 text-ink-900">{title}</h3>
            <div className="mt-2 text-sm leading-relaxed text-ink-500">{message}</div>
          </div>
          <button onClick={onCancel} className="text-ink-400 hover:text-ink-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="rounded-lg border border-ink-200 bg-white px-4 py-2 text-sm font-600 text-ink-700 transition hover:bg-ink-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-lg px-4 py-2 text-sm font-600 text-white transition ${
              danger ? 'bg-danger-500 hover:bg-danger-500/90' : 'bg-primary-600 hover:bg-primary-700'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

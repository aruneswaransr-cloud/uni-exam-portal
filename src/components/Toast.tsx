import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  show: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, type: ToastType = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 4000);
  }, []);

  function dismiss(id: number) {
    setToasts((t) => t.filter((x) => x.id !== id));
  }

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border bg-white px-4 py-3 shadow-lg ${
              t.type === 'success' ? 'border-success-500/30' :
              t.type === 'error' ? 'border-danger-500/30' :
              'border-primary-300'
            }`}
          >
            {t.type === 'success' && <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success-500" />}
            {t.type === 'error' && <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger-500" />}
            {t.type === 'info' && <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary-600" />}
            <p className="flex-1 text-sm font-500 text-ink-900">{t.message}</p>
            <button onClick={() => dismiss(t.id)} className="text-ink-400 hover:text-ink-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-ink-50 px-5">
          <div className="w-full max-w-md rounded-2xl border border-ink-200 bg-white p-8 text-center shadow-lg">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-danger-500/10 text-danger-500">
              <AlertCircle className="h-6 w-6" />
            </div>
            <h1 className="mt-4 font-display text-xl font-700 text-ink-900">
              Something went wrong
            </h1>
            <p className="mt-2 text-sm text-ink-500">
              An unexpected error occurred. Try refreshing the page — your data is safe.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-600 text-white transition hover:bg-primary-700"
            >
              <RefreshCw className="h-4 w-4" /> Refresh page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

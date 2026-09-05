import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '@/hooks/useAuth';
import { ToastProvider } from '@/components/Toast';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { supabaseConfigError } from '@/lib/supabase';
import { HomePage } from '@/pages/HomePage';
import { AdminLoginPage } from '@/pages/AdminLoginPage';
import { AdminDashboardPage } from '@/pages/AdminDashboardPage';
import { ParticipantPage } from '@/pages/ParticipantPage';
import { RequireAdmin } from '@/components/RequireAdmin';

function ConfigError() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-5">
      <div className="w-full max-w-md rounded-2xl border border-ink-200 bg-white p-8 text-center shadow-lg">
        <h1 className="font-display text-xl font-700 text-ink-900">Configuration error</h1>
        <p className="mt-2 text-sm text-ink-500">{supabaseConfigError}</p>
      </div>
    </div>
  );
}

function App() {
  if (supabaseConfigError) return <ConfigError />;

  return (
    <ErrorBoundary>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/admin" element={<AdminLoginPage />} />
              <Route
                path="/admin/dashboard"
                element={
                  <RequireAdmin>
                    <AdminDashboardPage />
                  </RequireAdmin>
                }
              />
              <Route path="/participant" element={<ParticipantPage />} />
              <Route path="*" element={<HomePage />} />
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;

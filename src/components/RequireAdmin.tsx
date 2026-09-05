import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { session, isAdmin, loading } = useAuth();

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-ink-50">
        <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!session) return <Navigate to="/admin" replace />;
  if (!isAdmin) return <Navigate to="/admin" replace />;

  return <>{children}</>;
}

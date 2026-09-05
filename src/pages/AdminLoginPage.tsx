import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ShieldCheck, ArrowLeft, Loader2, AlertCircle, Eye, EyeOff, UserPlus, LogIn } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Logo } from '@/components/Logo';

type Mode = 'signin' | 'signup';

export function AdminLoginPage() {
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setFullName('');
    setEmail('');
    setPassword('');
    setConfirmPw('');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === 'signup') {
      if (password.length < 8) {
        setError('Password must be at least 8 characters.');
        return;
      }
      if (password !== confirmPw) {
        setError('Passwords do not match.');
        return;
      }
    }

    setLoading(true);
    const result =
      mode === 'signin'
        ? await signIn(email.trim(), password)
        : await signUp(email.trim(), password, fullName.trim());
    setLoading(false);

    if (result.error) {
      setError(result.error);
      return;
    }
    navigate('/admin/dashboard');
  }

  return (
    <div className="flex min-h-screen flex-col bg-ink-50">
      <header className="border-b border-ink-200/70 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link to="/" className="flex items-center gap-2 text-sm font-500 text-ink-500 hover:text-ink-900">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          <Logo className="h-7" />
        </div>
      </header>

      <div className="flex flex-1 items-center justify-center px-5 py-10">
        <div className="w-full max-w-md">
          <div className="mb-6 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary-600 text-white shadow-sm">
              <ShieldCheck className="h-6 w-6" strokeWidth={2.2} />
            </div>
            <h1 className="mt-4 font-display text-2xl font-700 text-ink-900">
              {mode === 'signin' ? 'Admin Login' : 'Create Admin Account'}
            </h1>
            <p className="mt-1 text-sm text-ink-500">
              {mode === 'signin'
                ? 'Sign in to manage quizzes and evaluations.'
                : 'Register a new admin account to get started.'}
            </p>
          </div>

          {/* Mode toggle */}
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl border border-ink-200 bg-white p-1 shadow-[0_1px_2px_rgba(16,20,28,0.04)]">
            <button
              type="button"
              onClick={() => switchMode('signin')}
              className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-600 transition ${
                mode === 'signin' ? 'bg-primary-600 text-white' : 'text-ink-500 hover:text-ink-900'
              }`}
            >
              <LogIn className="h-4 w-4" /> Sign in
            </button>
            <button
              type="button"
              onClick={() => switchMode('signup')}
              className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-600 transition ${
                mode === 'signup' ? 'bg-primary-600 text-white' : 'text-ink-500 hover:text-ink-900'
              }`}
            >
              <UserPlus className="h-4 w-4" /> Create account
            </button>
          </div>

          <form
            onSubmit={handleSubmit}
            className="rounded-2xl border border-ink-200/70 bg-white p-6 shadow-[0_1px_2px_rgba(16,20,28,0.04)]"
          >
            {error && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-danger-500/30 bg-danger-500/5 px-3 py-2.5 text-sm text-danger-500">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {mode === 'signup' && (
              <>
                <label className="block text-sm font-500 text-ink-700">Full name</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                  placeholder="Jane Doe"
                />
              </>
            )}

            <label className="mt-4 block text-sm font-500 text-ink-700">Email</label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
              placeholder="admin@college.edu"
            />

            <label className="mt-4 block text-sm font-500 text-ink-700">Password</label>
            <div className="relative mt-1.5">
              <input
                type={showPw ? 'text' : 'password'}
                required
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-ink-200 bg-white px-3.5 py-2.5 pr-10 text-sm text-ink-900 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                placeholder={mode === 'signup' ? 'At least 8 characters' : '••••••••'}
              />
              <button
                type="button"
                onClick={() => setShowPw((s) => !s)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600"
                tabIndex={-1}
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            {mode === 'signup' && (
              <>
                <label className="mt-4 block text-sm font-500 text-ink-700">Confirm password</label>
                <input
                  type={showPw ? 'text' : 'password'}
                  required
                  autoComplete="new-password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                  placeholder="••••••••"
                />
              </>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-600 text-white transition hover:bg-primary-700 disabled:opacity-60"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading
                ? mode === 'signin' ? 'Signing in…' : 'Creating account…'
                : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <p className="mt-4 text-center text-sm text-ink-500">
            {mode === 'signin' ? (
              <>
                Don't have an account?{' '}
                <button onClick={() => switchMode('signup')} className="font-600 text-primary-600 hover:underline">
                  Create one
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button onClick={() => switchMode('signin')} className="font-600 text-primary-600 hover:underline">
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

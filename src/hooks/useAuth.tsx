import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { AdminProfile, AuthContextValue } from '@/types/auth';

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AdminProfile | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(uid: string) {
    const { data, error } = await supabase
      .from('admin_profiles')
      .select('id, email, full_name')
      .eq('id', uid)
      .maybeSingle();
    if (error) {
      setProfile(null);
      return;
    }
    setProfile(data as AdminProfile | null);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        setLoading(false);
        return;
      }
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session?.user) {
        loadProfile(data.session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    }).catch(() => setLoading(false));

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession?.user) {
        (async () => {
          await loadProfile(newSession.user.id);
          setLoading(false);
        })();
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return { error: null };
  }

  async function signUp(email: string, password: string, fullName: string) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    if (error) return { error: error.message };
    if (!data.user) return { error: 'Sign-up failed. Please try again.' };

    // Create the admin profile row. RLS allows a user to insert their own row.
    const { error: profileError } = await supabase.from('admin_profiles').insert({
      id: data.user.id,
      email,
      full_name: fullName,
    });
    if (profileError) {
      return { error: 'Account created but profile setup failed: ' + profileError.message };
    }
    return { error: null };
  }

  async function signOut() {
    await supabase.auth.signOut();
    setProfile(null);
  }

  const value: AuthContextValue = {
    session,
    user,
    profile,
    loading,
    isAdmin: !!profile,
    signIn,
    signUp,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

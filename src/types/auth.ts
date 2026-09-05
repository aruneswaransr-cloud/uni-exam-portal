import type { Session, User } from '@supabase/supabase-js';

export interface AdminProfile {
  id: string;
  email: string;
  full_name: string | null;
}

export interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: AdminProfile | null;
  loading: boolean;
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

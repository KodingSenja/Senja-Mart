'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { UserProfile } from 'types/user';
import { getCurrentUser } from 'lib/services/auth';
import { supabase, isSupabaseConfigured } from 'lib/supabase/client';

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const current = await getCurrentUser();
    setUser(current);
    setLoading(false);
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      const current = await getCurrentUser();
      if (!active) return;
      setUser(current);
      setLoading(false);
    };
    load();

    if (isSupabaseConfigured && supabase) {
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange(() => {
        window.setTimeout(() => {
          if (active) void load();
        }, 300);
      });
      return () => {
        active = false;
        subscription.unsubscribe();
      };
    }
    return () => {
      active = false;
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

// Global auth/session context. Determines the caller's role from the Supabase
// JWT app_metadata (set server-side only), so route guards and RLS agree.

import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase/client.js';
import { ownerLogin as ownerLoginApi } from '../lib/data/adminApi.js';

const AuthContext = createContext(null);

function roleFromSession(session) {
  return session?.user?.app_metadata?.role || null;
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession ?? null);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const adminLogin = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error('Invalid email or password.');
    const role = data.session?.user?.app_metadata?.role;
    if (role !== 'admin') {
      await supabase.auth.signOut();
      throw new Error('This account is not authorized for YEROME access.');
    }
    return data.session;
  }, []);

  const ownerLogin = useCallback(async (username, password) => {
    const { access_token, refresh_token } = await ownerLoginApi(username, password);
    const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
    if (error) throw new Error('Could not establish session.');
    return data.session;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
  }, []);

  const value = useMemo(() => {
    const role = roleFromSession(session);
    return {
      session,
      user: session?.user ?? null,
      role,
      isAdmin: role === 'admin',
      isOwner: role === 'owner',
      isAuthenticated: Boolean(session),
      loading,
      configured: isSupabaseConfigured,
      adminLogin,
      ownerLogin,
      signOut,
    };
  }, [session, loading, adminLogin, ownerLogin, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider.');
  return ctx;
}

// App data/auth client. Two backends:
//   * Production / Supabase: the real @supabase/supabase-js client (RLS-protected
//     publishable key only). Used whenever VITE_BACKEND !== 'local'.
//   * Local development (VITE_BACKEND=local): a drop-in adapter that talks to the
//     bundled SQLite dev backend (see runAppLocally.sh). Same app code, no cloud.
//
// The service-role key is NEVER imported here in either mode.

import { createClient } from '@supabase/supabase-js';
import { createLocalClient } from './localClient.js';

const useLocalBackend = import.meta.env.VITE_BACKEND === 'local';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = useLocalBackend || Boolean(url && anonKey);
export const backendMode = useLocalBackend ? 'local' : 'supabase';

if (!isSupabaseConfigured) {
  // eslint-disable-next-line no-console
  console.warn(
    'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY, ' +
      'or run locally with VITE_BACKEND=local (see runAppLocally.sh).',
  );
}

export const supabase = useLocalBackend
  ? createLocalClient()
  : createClient(url || 'http://localhost:54321', anonKey || 'public-anon-key', {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });

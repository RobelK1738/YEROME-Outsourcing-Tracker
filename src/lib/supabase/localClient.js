// Drop-in, minimal Supabase-compatible client for LOCAL DEVELOPMENT ONLY.
//
// It implements just the slice of the supabase-js surface this app uses
// (a chainable query builder, .rpc(), and .auth.*) and talks to the local
// SQLite backend (server/localBackend.mjs) via same-origin paths that Vite
// proxies in dev. In production the app uses the real Supabase client instead;
// this file is never exercised there.

const SESSION_KEY = 'oo_local_session';
const LOCAL_BASE = '/local';

// ---- session persistence -------------------------------------------------
function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function saveSession(session) {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}
function decodeUser(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return {
      id: payload.sub,
      email: payload.email,
      app_metadata: { role: payload.role, owner_id: payload.owner_id || undefined },
      user_metadata: { display_name: payload.display_name || undefined, username: payload.username || undefined },
    };
  } catch {
    return null;
  }
}

// ---- transport ------------------------------------------------------------
async function post(path, body) {
  const session = loadSession();
  const headers = { 'Content-Type': 'application/json' };
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  const res = await fetch(`${LOCAL_BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  return res.json();
}

// ---- chainable query builder ---------------------------------------------
class LocalQuery {
  constructor(table) {
    this.table = table;
    this.op = 'select';
    this.columns = '*';
    this.filters = [];
    this._order = [];
    this._limit = null;
    this._single = null;
    this.returning = false;
  }

  select(columns = '*') {
    this.columns = columns;
    if (this.op !== 'select') this.returning = true;
    return this;
  }
  insert(values) {
    this.op = 'insert';
    this.values = values;
    return this;
  }
  update(patch) {
    this.op = 'update';
    this.patch = patch;
    return this;
  }
  upsert(values, options = {}) {
    this.op = 'upsert';
    this.values = values;
    this.onConflict = options.onConflict;
    this.ignoreDuplicates = options.ignoreDuplicates;
    return this;
  }
  delete() {
    this.op = 'delete';
    return this;
  }
  eq(col, val) {
    this.filters.push({ col, op: 'eq', val });
    return this;
  }
  in(col, val) {
    this.filters.push({ col, op: 'in', val });
    return this;
  }
  gte(col, val) {
    this.filters.push({ col, op: 'gte', val });
    return this;
  }
  is(col, val) {
    this.filters.push({ col, op: 'is', val });
    return this;
  }
  order(col, options = {}) {
    this._order.push({ col, ascending: options.ascending !== false });
    return this;
  }
  limit(n) {
    this._limit = n;
    return this;
  }
  maybeSingle() {
    this._single = 'maybe';
    return this;
  }
  single() {
    this._single = 'one';
    return this;
  }

  _payload() {
    return {
      table: this.table,
      op: this.op,
      columns: this.columns,
      filters: this.filters,
      order: this._order,
      limit: this._limit,
      single: this._single,
      values: this.values,
      patch: this.patch,
      onConflict: this.onConflict,
      ignoreDuplicates: this.ignoreDuplicates,
      returning: this.returning || this.op === 'select',
    };
  }

  async _exec() {
    try {
      const json = await post('/query', this._payload());
      return { data: json.data ?? null, error: json.error ?? null };
    } catch (e) {
      return { data: null, error: { message: e.message || 'Request failed' } };
    }
  }

  then(onFulfilled, onRejected) {
    return this._exec().then(onFulfilled, onRejected);
  }
}

// ---- auth -----------------------------------------------------------------
function createAuth() {
  const listeners = new Set();
  function notify(event, session) {
    for (const cb of listeners) cb(event, session);
  }

  return {
    async getSession() {
      return { data: { session: loadSession() }, error: null };
    },
    async getUser() {
      const session = loadSession();
      return { data: { user: session?.user ?? null }, error: null };
    },
    onAuthStateChange(callback) {
      listeners.add(callback);
      return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
    },
    async signInWithPassword({ email, password }) {
      const json = await post('/auth/password', { email, password });
      if (json.error) return { data: { session: null, user: null }, error: { message: json.error } };
      const session = json.session;
      session.user = session.user || decodeUser(session.access_token);
      saveSession(session);
      notify('SIGNED_IN', session);
      return { data: { session, user: session.user }, error: null };
    },
    async setSession({ access_token, refresh_token }) {
      const user = decodeUser(access_token);
      if (!user) return { data: { session: null }, error: { message: 'Invalid session token.' } };
      const session = { access_token, refresh_token, token_type: 'bearer', user };
      saveSession(session);
      notify('SIGNED_IN', session);
      return { data: { session }, error: null };
    },
    async signOut() {
      saveSession(null);
      notify('SIGNED_OUT', null);
      return { error: null };
    },
  };
}

// ---- client ---------------------------------------------------------------
export function createLocalClient() {
  return {
    from(table) {
      return new LocalQuery(table);
    },
    async rpc(fn, args = {}) {
      try {
        const json = await post('/rpc', { fn, args });
        return { data: json.data ?? null, error: json.error ?? null };
      } catch (e) {
        return { data: null, error: { message: e.message || 'RPC failed' } };
      }
    },
    auth: createAuth(),
  };
}

/*
 * sync.js — optional cloud sync via a private (secret) GitHub Gist.
 *
 * Why a Gist: it needs no server of your own, the data stays private, and it
 * keeps your training numbers OUT of the (public) website repo. You paste a
 * gist-scoped GitHub token once; it is stored only in this browser's
 * localStorage and used solely to read/write your own gist.
 *
 * Reconciliation is last-write-wins per record (see DB.applyRemote): logging
 * on your phone and later opening your laptop merges cleanly without
 * duplicating sessions.
 *
 * The app is fully usable without ever configuring this.
 */
(function (global) {
  'use strict';

  const CFG_KEY = 'workoutlog.sync';
  const DIRTY_KEY = 'workoutlog.sync.dirty'; // local edits not yet pushed
  const GIST_FILE = 'workout-log.json';
  const API = 'https://api.github.com';

  function getConfig() {
    try {
      return Object.assign({ token: '', gistId: '', auto: true, lastSync: 0 },
        JSON.parse(localStorage.getItem(CFG_KEY) || '{}'));
    } catch (e) {
      return { token: '', gistId: '', auto: true, lastSync: 0 };
    }
  }
  function setConfig(patch) {
    const cfg = Object.assign(getConfig(), patch);
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
    return cfg;
  }
  function isConfigured() {
    const c = getConfig();
    return !!(c.token && c.gistId);
  }
  function isDirty() { return localStorage.getItem(DIRTY_KEY) === '1'; }
  function setDirty(v) {
    if (v) localStorage.setItem(DIRTY_KEY, '1');
    else localStorage.removeItem(DIRTY_KEY);
  }

  // ---- status events ----
  const statusListeners = [];
  function onStatus(cb) { statusListeners.push(cb); }
  let lastStatus = { state: 'idle', message: '' };
  function emit(state, message) {
    lastStatus = { state: state, message: message || '' };
    for (const cb of statusListeners) { try { cb(lastStatus); } catch (e) { /* ignore */ } }
  }
  function getStatus() { return lastStatus; }

  // ---- GitHub API helper ----
  async function api(path, opts) {
    opts = opts || {};
    const cfg = getConfig();
    if (!cfg.token) throw new Error('No token configured');
    const res = await fetch(API + path, {
      method: opts.method || 'GET',
      headers: {
        'Authorization': 'Bearer ' + cfg.token,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401) throw new Error('Token rejected (check it has the "gist" scope)');
    if (res.status === 404) throw new Error('Gist not found (check the Gist ID)');
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).message || ''; } catch (e) { /* ignore */ }
      throw new Error('GitHub ' + res.status + (detail ? ': ' + detail : ''));
    }
    return res.json();
  }

  // Verify a token works and report the account it belongs to.
  async function testToken(token) {
    const res = await fetch(API + '/user', {
      headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error('Token check failed (' + res.status + ')');
    const user = await res.json();
    return user.login;
  }

  // Create a fresh private gist seeded with current data; stores its id.
  async function createGist() {
    emit('working', 'Creating sync gist…');
    const gist = await api('/gists', {
      method: 'POST',
      body: {
        description: 'Workout Log — personal data (private). Managed by the Workout Log app.',
        public: false,
        files: { [GIST_FILE]: { content: DB.exportJSON() } },
      },
    });
    setConfig({ gistId: gist.id, lastSync: Date.now() });
    setDirty(false);
    emit('ok', 'Sync created');
    return gist.id;
  }

  async function pullRaw() {
    const cfg = getConfig();
    const gist = await api('/gists/' + cfg.gistId);
    const file = gist.files && gist.files[GIST_FILE];
    if (!file) throw new Error('Gist has no ' + GIST_FILE + ' file');
    if (file.truncated && file.raw_url) {
      const res = await fetch(file.raw_url, { headers: { 'Authorization': 'Bearer ' + cfg.token } });
      return res.text();
    }
    return file.content;
  }

  async function pushRaw() {
    const cfg = getConfig();
    await api('/gists/' + cfg.gistId, {
      method: 'PATCH',
      body: { files: { [GIST_FILE]: { content: DB.exportJSON() } } },
    });
    setConfig({ lastSync: Date.now() });
    setDirty(false);
  }

  // Full reconcile: pull + merge, then push the merged result back so every
  // device converges. `onChanged` is called if the local data changed.
  let syncing = false;
  async function sync(opts) {
    opts = opts || {};
    if (!isConfigured()) return false;
    if (syncing) return false;
    syncing = true;
    let changed = false;
    try {
      emit('working', 'Syncing…');
      const text = await pullRaw();
      try {
        changed = DB.applyRemote(JSON.parse(text));
      } catch (e) {
        throw new Error('Remote data was unreadable; not overwriting local. (' + e.message + ')');
      }
      await pushRaw();
      emit('ok', 'Synced ' + new Date().toLocaleTimeString());
      if (changed && typeof opts.onChanged === 'function') opts.onChanged();
    } catch (e) {
      setDirty(true); // remember we still owe a push
      emit('error', e.message || String(e));
      throw e;
    } finally {
      syncing = false;
    }
    return changed;
  }

  function disconnect() {
    localStorage.removeItem(CFG_KEY);
    setDirty(false);
    emit('idle', 'Disconnected');
  }

  // ---- auto-sync wiring ----
  // Debounced push after local edits; full sync on startup / regaining focus.
  let pushTimer = null;
  let onChangedCb = null;
  function setOnRemoteChange(cb) { onChangedCb = cb; }

  function schedulePush() {
    const cfg = getConfig();
    if (!isConfigured() || !cfg.auto) return;
    setDirty(true);
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      // a push is really a sync so concurrent edits on another device merge in
      sync({ onChanged: () => onChangedCb && onChangedCb() }).catch(() => {});
    }, 2500);
  }

  function init(onRemoteChange) {
    setOnRemoteChange(onRemoteChange);
    // local edits -> schedule a push
    if (global.DB && DB.onChange) DB.onChange(() => schedulePush());

    const cfg = getConfig();
    if (isConfigured() && cfg.auto) {
      // initial reconcile (also flushes anything left dirty from offline use)
      sync({ onChanged: () => onChangedCb && onChangedCb() }).catch(() => {});
      // re-sync when the app/tab regains focus (e.g. back from gym)
      global.addEventListener('focus', () => {
        sync({ onChanged: () => onChangedCb && onChangedCb() }).catch(() => {});
      });
    }
  }

  global.Sync = {
    getConfig, setConfig, isConfigured, isDirty,
    testToken, createGist, sync, disconnect,
    onStatus, getStatus, init,
    GIST_FILE,
  };
})(window);

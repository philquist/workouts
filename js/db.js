/*
 * db.js — data layer for the workout log.
 *
 * Everything is stored locally in localStorage. The whole app talks to the
 * `DB` object only (never to localStorage directly), so a future version can
 * swap this implementation for a synced backend without touching the UI.
 *
 * Data shape (schema v1):
 * {
 *   version: 1,
 *   settings: { unit: 'lb' | 'kg' },
 *   sessions: [
 *     {
 *       id, date: 'YYYY-MM-DD', notes,
 *       exercises: [
 *         { id, name, sets: [ { id, weight, reps, rpe } ] }
 *       ]
 *     }
 *   ],
 *   bodyweights: [ { id, date: 'YYYY-MM-DD', value } ]
 * }
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'workoutlog.v1';
  const SCHEMA_VERSION = 1;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function emptyState() {
    return {
      version: SCHEMA_VERSION,
      settings: { unit: 'lb' },
      sessions: [],
      bodyweights: [],
    };
  }

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      const parsed = JSON.parse(raw);
      return migrate(parsed);
    } catch (e) {
      console.error('Failed to load data, starting fresh:', e);
      return emptyState();
    }
  }

  function migrate(data) {
    // Single schema version for now; this is where future migrations go.
    const base = emptyState();
    return {
      version: SCHEMA_VERSION,
      settings: Object.assign(base.settings, data.settings || {}),
      sessions: Array.isArray(data.sessions) ? data.sessions : [],
      bodyweights: Array.isArray(data.bodyweights) ? data.bodyweights : [],
    };
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error('Failed to save:', e);
      alert('Could not save — storage may be full or disabled.');
    }
  }

  // ---- date helpers ----
  function todayISO() {
    const d = new Date();
    const tzOffset = d.getTimezoneOffset() * 60000;
    return new Date(d - tzOffset).toISOString().slice(0, 10);
  }

  // ---- settings ----
  function getSettings() {
    return Object.assign({}, state.settings);
  }
  function setUnit(unit) {
    state.settings.unit = unit === 'kg' ? 'kg' : 'lb';
    persist();
  }

  // ---- sessions ----
  function getSessions() {
    // newest first
    return state.sessions.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }
  function getSession(id) {
    return state.sessions.find((s) => s.id === id) || null;
  }
  function getSessionByDate(date) {
    return state.sessions.find((s) => s.date === date) || null;
  }
  function getOrCreateSession(date) {
    let s = getSessionByDate(date);
    if (!s) {
      s = { id: uid(), date: date, notes: '', exercises: [] };
      state.sessions.push(s);
      persist();
    }
    return s;
  }
  function updateSession(id, patch) {
    const s = getSession(id);
    if (!s) return null;
    Object.assign(s, patch);
    persist();
    return s;
  }
  function deleteSession(id) {
    state.sessions = state.sessions.filter((s) => s.id !== id);
    persist();
  }

  // ---- exercises within a session ----
  function addExercise(sessionId, name) {
    const s = getSession(sessionId);
    if (!s) return null;
    const ex = { id: uid(), name: name.trim(), sets: [] };
    s.exercises.push(ex);
    persist();
    return ex;
  }
  function renameExercise(sessionId, exerciseId, name) {
    const ex = findExercise(sessionId, exerciseId);
    if (ex) { ex.name = name.trim(); persist(); }
    return ex;
  }
  function deleteExercise(sessionId, exerciseId) {
    const s = getSession(sessionId);
    if (!s) return;
    s.exercises = s.exercises.filter((e) => e.id !== exerciseId);
    persist();
  }
  function findExercise(sessionId, exerciseId) {
    const s = getSession(sessionId);
    if (!s) return null;
    return s.exercises.find((e) => e.id === exerciseId) || null;
  }

  // ---- sets ----
  function addSet(sessionId, exerciseId, set) {
    const ex = findExercise(sessionId, exerciseId);
    if (!ex) return null;
    const newSet = {
      id: uid(),
      weight: num(set.weight),
      reps: num(set.reps),
      rpe: set.rpe == null || set.rpe === '' ? null : num(set.rpe),
    };
    ex.sets.push(newSet);
    persist();
    return newSet;
  }
  function updateSet(sessionId, exerciseId, setId, patch) {
    const ex = findExercise(sessionId, exerciseId);
    if (!ex) return null;
    const set = ex.sets.find((x) => x.id === setId);
    if (!set) return null;
    if ('weight' in patch) set.weight = num(patch.weight);
    if ('reps' in patch) set.reps = num(patch.reps);
    if ('rpe' in patch) set.rpe = patch.rpe == null || patch.rpe === '' ? null : num(patch.rpe);
    persist();
    return set;
  }
  function deleteSet(sessionId, exerciseId, setId) {
    const ex = findExercise(sessionId, exerciseId);
    if (!ex) return;
    ex.sets = ex.sets.filter((x) => x.id !== setId);
    persist();
  }

  function num(v) {
    const n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  // ---- bodyweight ----
  function getBodyweights() {
    return state.bodyweights.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  function logBodyweight(date, value) {
    const existing = state.bodyweights.find((b) => b.date === date);
    if (existing) {
      existing.value = num(value);
    } else {
      state.bodyweights.push({ id: uid(), date: date, value: num(value) });
    }
    persist();
  }
  function deleteBodyweight(id) {
    state.bodyweights = state.bodyweights.filter((b) => b.id !== id);
    persist();
  }

  // ---- analytics ----
  // Distinct exercise names ever logged, most-recent first, for autocomplete.
  function exerciseNames() {
    const seen = new Map(); // name -> latest date
    for (const s of state.sessions) {
      for (const ex of s.exercises) {
        const key = ex.name.trim();
        if (!key) continue;
        const prev = seen.get(key);
        if (!prev || s.date > prev) seen.set(key, s.date);
      }
    }
    return Array.from(seen.entries())
      .sort((a, b) => (a[1] < b[1] ? 1 : -1))
      .map((e) => e[0]);
  }

  // Epley estimated one-rep max.
  function estimate1RM(weight, reps) {
    if (!weight || !reps) return 0;
    if (reps === 1) return weight;
    return weight * (1 + reps / 30);
  }

  // Per-session aggregated history for one exercise name (oldest first).
  function exerciseHistory(name) {
    const target = name.trim().toLowerCase();
    const rows = [];
    for (const s of state.sessions) {
      for (const ex of s.exercises) {
        if (ex.name.trim().toLowerCase() !== target) continue;
        if (!ex.sets.length) continue;
        let maxWeight = 0, best1RM = 0, volume = 0, topReps = 0;
        for (const set of ex.sets) {
          const w = set.weight, r = set.reps;
          volume += w * r;
          if (w > maxWeight) maxWeight = w;
          const e = estimate1RM(w, r);
          if (e > best1RM) best1RM = e;
          if (r > topReps) topReps = r;
        }
        rows.push({
          date: s.date,
          sessionId: s.id,
          maxWeight: round(maxWeight),
          est1RM: round(best1RM),
          volume: round(volume),
          sets: ex.sets.length,
          topReps,
        });
      }
    }
    rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return rows;
  }

  // Personal records for an exercise name.
  function personalRecords(name) {
    const hist = exerciseHistory(name);
    if (!hist.length) return null;
    let maxWeight = hist[0], best1RM = hist[0], maxVolume = hist[0];
    for (const r of hist) {
      if (r.maxWeight > maxWeight.maxWeight) maxWeight = r;
      if (r.est1RM > best1RM.est1RM) best1RM = r;
      if (r.volume > maxVolume.volume) maxVolume = r;
    }
    return { maxWeight, best1RM, maxVolume, totalSessions: hist.length };
  }

  function round(n) {
    return Math.round(n * 10) / 10;
  }

  // High-level stats for the History/Trends headers.
  function summary() {
    const sessions = state.sessions.length;
    let totalSets = 0, totalVolume = 0;
    for (const s of state.sessions) {
      for (const ex of s.exercises) {
        for (const set of ex.sets) {
          totalSets++;
          totalVolume += set.weight * set.reps;
        }
      }
    }
    return { sessions, totalSets, totalVolume: round(totalVolume), exercises: exerciseNames().length };
  }

  // ---- import / export ----
  function exportJSON() {
    return JSON.stringify(state, null, 2);
  }
  function importJSON(text, mode) {
    const incoming = JSON.parse(text);
    const clean = migrate(incoming);
    if (mode === 'merge') {
      const byDate = new Map(state.sessions.map((s) => [s.date, s]));
      for (const s of clean.sessions) {
        if (byDate.has(s.date)) {
          // append exercises from imported session to existing one
          byDate.get(s.date).exercises.push(...s.exercises);
        } else {
          state.sessions.push(s);
          byDate.set(s.date, s);
        }
      }
      const bwDates = new Set(state.bodyweights.map((b) => b.date));
      for (const b of clean.bodyweights) {
        if (!bwDates.has(b.date)) state.bodyweights.push(b);
      }
    } else {
      state = clean;
    }
    persist();
  }
  function clearAll() {
    state = emptyState();
    persist();
  }

  global.DB = {
    todayISO,
    getSettings, setUnit,
    getSessions, getSession, getSessionByDate, getOrCreateSession, updateSession, deleteSession,
    addExercise, renameExercise, deleteExercise, findExercise,
    addSet, updateSet, deleteSet,
    getBodyweights, logBodyweight, deleteBodyweight,
    exerciseNames, exerciseHistory, personalRecords, estimate1RM, summary,
    exportJSON, importJSON, clearAll,
  };
})(window);

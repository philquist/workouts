/*
 * app.js — UI + hash router for the workout log.
 */
(function () {
  'use strict';

  const appEl = document.getElementById('app');
  const titleEl = document.getElementById('view-title');
  const toastEl = document.getElementById('toast');

  // ---------- small helpers ----------
  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }
  function unit() { return DB.getSettings().unit; }
  function fmtWeight(w) { return `${trimNum(w)} ${unit()}`; }
  function trimNum(n) { return (Math.round(n * 100) / 100).toString(); }
  function prettyDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const today = DB.todayISO();
    const yesterday = (() => {
      const dt = new Date(); dt.setDate(dt.getDate() - 1);
      const off = dt.getTimezoneOffset() * 60000;
      return new Date(dt - off).toISOString().slice(0, 10);
    })();
    if (iso === today) return 'Today';
    if (iso === yesterday) return 'Yesterday';
    return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: y !== new Date().getFullYear() ? 'numeric' : undefined });
  }

  // ---------- router ----------
  const routes = {
    '/log': renderLog,
    '/history': renderHistory,
    '/trends': renderTrends,
    '/data': renderData,
  };

  function currentRoute() {
    const hash = location.hash.replace(/^#/, '') || '/log';
    const path = hash.split('?')[0];
    const query = {};
    const qs = hash.split('?')[1];
    if (qs) qs.split('&').forEach((p) => {
      const [k, v] = p.split('=');
      query[decodeURIComponent(k)] = decodeURIComponent(v || '');
    });
    return { path, query };
  }

  function router() {
    const { path, query } = currentRoute();
    const fn = routes[path] || renderLog;
    appEl.scrollTop = 0;
    appEl.innerHTML = '';
    fn(query);
    // highlight active tab
    document.querySelectorAll('.tab').forEach((t) => {
      t.classList.toggle('active', '#' + path === t.getAttribute('href'));
    });
  }

  window.addEventListener('hashchange', router);

  // ============================================================
  // LOG VIEW
  // ============================================================
  function renderLog(query) {
    const date = query.date || DB.todayISO();
    titleEl.textContent = date === DB.todayISO() ? 'Today' : prettyDate(date);

    const session = DB.getOrCreateSession(date);

    const view = el('<div class="view"></div>');

    // date switcher
    const dateBar = el(`
      <div class="datebar">
        <button class="ghost-btn" id="prev-day" aria-label="Previous day">‹</button>
        <label class="date-pick">
          <input type="date" id="log-date" value="${date}" max="${DB.todayISO()}" />
          <span class="date-label">${esc(prettyDate(date))}</span>
        </label>
        <button class="ghost-btn" id="next-day" aria-label="Next day">›</button>
      </div>`);
    view.appendChild(dateBar);

    // exercises container
    const list = el('<div id="ex-list"></div>');
    view.appendChild(list);
    renderExercises(list, session);

    // load from program (shown only when the parsed program is available)
    if (PROGRAM && PROGRAM.weeks && PROGRAM.weeks.length) {
      const progBtn = el(`<button class="ghost-btn program-btn" id="load-program">📋 Load a day from your program</button>`);
      progBtn.addEventListener('click', () => openProgramPicker(date));
      view.appendChild(progBtn);
    }

    // add exercise
    const adder = el(`
      <form class="add-exercise card" id="add-ex-form" autocomplete="off">
        <input list="ex-suggestions" id="new-ex-name" placeholder="Add exercise (e.g. Bench Press)" aria-label="Exercise name" />
        <button type="submit" class="primary-btn">Add</button>
        <datalist id="ex-suggestions">
          ${allExerciseNames().map((n) => `<option value="${esc(n)}"></option>`).join('')}
        </datalist>
      </form>`);
    view.appendChild(adder);

    // session notes
    const notes = el(`
      <div class="card">
        <label class="field-label" for="session-notes">Session notes</label>
        <textarea id="session-notes" rows="2" placeholder="How did it go?">${esc(session.notes || '')}</textarea>
      </div>`);
    view.appendChild(notes);

    appEl.appendChild(view);

    // events
    dateBar.querySelector('#log-date').addEventListener('change', (e) => {
      location.hash = `#/log?date=${e.target.value}`;
    });
    dateBar.querySelector('#prev-day').addEventListener('click', () => shiftDay(date, -1));
    dateBar.querySelector('#next-day').addEventListener('click', () => shiftDay(date, 1));

    adder.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = adder.querySelector('#new-ex-name');
      const name = input.value.trim();
      if (!name) return;
      DB.addExercise(session.id, name);
      input.value = '';
      renderExercises(list, DB.getSession(session.id));
      // focus first weight field of the new exercise
      const last = list.querySelector('.exercise:last-child .set-weight');
      if (last) last.focus();
    });

    notes.querySelector('#session-notes').addEventListener('input', (e) => {
      DB.updateSession(session.id, { notes: e.target.value });
    });
  }

  function shiftDay(date, delta) {
    const [y, m, d] = date.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + delta);
    const today = new Date(DB.todayISO());
    if (dt > today && delta > 0) { toast("Can't log the future 🙂"); return; }
    const off = dt.getTimezoneOffset() * 60000;
    const iso = new Date(dt - off).toISOString().slice(0, 10);
    location.hash = `#/log?date=${iso}`;
  }

  function renderExercises(container, session) {
    container.innerHTML = '';
    if (!session.exercises.length) {
      container.appendChild(el(`<div class="empty">No exercises yet. Add your first one below 👇</div>`));
      return;
    }
    session.exercises.forEach((ex) => {
      container.appendChild(buildExerciseCard(session, ex));
    });
  }

  function buildExerciseCard(session, ex) {
    const card = el(`<div class="card exercise" data-ex="${ex.id}"></div>`);

    const head = el(`
      <div class="ex-head">
        <h3 class="ex-name" title="Tap to rename">${esc(ex.name)}</h3>
        <button class="icon-btn del-ex" aria-label="Delete exercise">🗑️</button>
      </div>`);
    card.appendChild(head);

    // program target + "last time" hints
    const meta = buildExerciseMeta(session, ex);
    if (meta) card.appendChild(meta);

    // sets table
    const table = el(`
      <div class="sets">
        <div class="set-row set-header">
          <span>Set</span><span>Weight</span><span>Reps</span><span>RPE</span><span></span>
        </div>
      </div>`);
    ex.sets.forEach((set, i) => table.appendChild(buildSetRow(session, ex, set, i)));
    card.appendChild(table);

    // add-set row
    const last = ex.sets[ex.sets.length - 1];
    const addRow = el(`
      <form class="set-row add-set" autocomplete="off">
        <span class="set-num">+</span>
        <input class="set-weight" type="number" inputmode="decimal" step="0.5" placeholder="${last ? trimNum(last.weight) : 'wt'}" aria-label="Weight" />
        <input class="set-reps" type="number" inputmode="numeric" step="1" placeholder="${last ? last.reps : 'reps'}" aria-label="Reps" />
        <input class="set-rpe" type="number" inputmode="decimal" step="0.5" min="1" max="10" placeholder="rpe" aria-label="RPE" />
        <button type="submit" class="add-set-btn" aria-label="Add set">Add</button>
      </form>`);
    card.appendChild(addRow);

    // events
    head.querySelector('.del-ex').addEventListener('click', () => {
      if (confirm(`Delete "${ex.name}" and its sets?`)) {
        DB.deleteExercise(session.id, ex.id);
        card.remove();
        if (!DB.getSession(session.id).exercises.length) {
          renderExercises(card.parentElement, DB.getSession(session.id));
        }
      }
    });

    head.querySelector('.ex-name').addEventListener('click', (e) => {
      const h = e.currentTarget;
      const name = prompt('Rename exercise', ex.name);
      if (name && name.trim()) {
        DB.renameExercise(session.id, ex.id, name);
        h.textContent = name.trim();
      }
    });

    addRow.addEventListener('submit', (e) => {
      e.preventDefault();
      const w = addRow.querySelector('.set-weight');
      const r = addRow.querySelector('.set-reps');
      const rpe = addRow.querySelector('.set-rpe');
      const weight = w.value === '' ? (last ? last.weight : 0) : w.value;
      const reps = r.value === '' ? (last ? last.reps : 0) : r.value;
      if (!reps || Number(reps) <= 0) { r.focus(); toast('Enter reps'); return; }
      DB.addSet(session.id, ex.id, { weight, reps, rpe: rpe.value });
      // re-render just this card to refresh set numbers + placeholders
      const fresh = buildExerciseCard(session, DB.findExercise(session.id, ex.id));
      card.replaceWith(fresh);
      const nw = fresh.querySelector('.set-weight');
      if (nw) nw.focus();
    });

    return card;
  }

  function buildExerciseMeta(session, ex) {
    const bits = [];
    if (ex.target && (ex.target.scheme || ex.target.sets)) {
      const t = ex.target;
      let s = 'Target: ' + (t.scheme || (t.sets + ' sets'));
      if (t.tempo) s += ' · tempo ' + t.tempo;
      bits.push(`<div class="ex-target">${esc(s)}</div>`);
    }
    const last = DB.lastPerformance(ex.name, session.date);
    if (last) {
      const sets = last.sets.map((x) => `${trimNum(x.weight)}×${x.reps}`).join(', ');
      bits.push(`<div class="ex-last">Last (${esc(prettyDate(last.date))}): ${esc(sets)}</div>`);
    }
    if (!bits.length) return null;
    return el(`<div class="ex-meta">${bits.join('')}</div>`);
  }

  function buildSetRow(session, ex, set, i) {
    const row = el(`
      <div class="set-row" data-set="${set.id}">
        <span class="set-num">${i + 1}</span>
        <input class="cell set-weight" type="number" inputmode="decimal" step="0.5" value="${set.weight}" aria-label="Weight" />
        <input class="cell set-reps" type="number" inputmode="numeric" step="1" value="${set.reps}" aria-label="Reps" />
        <input class="cell set-rpe" type="number" inputmode="decimal" step="0.5" min="1" max="10" value="${set.rpe == null ? '' : set.rpe}" placeholder="–" aria-label="RPE" />
        <button class="icon-btn del-set" aria-label="Delete set">✕</button>
      </div>`);

    row.querySelector('.set-weight').addEventListener('change', (e) => DB.updateSet(session.id, ex.id, set.id, { weight: e.target.value }));
    row.querySelector('.set-reps').addEventListener('change', (e) => DB.updateSet(session.id, ex.id, set.id, { reps: e.target.value }));
    row.querySelector('.set-rpe').addEventListener('change', (e) => DB.updateSet(session.id, ex.id, set.id, { rpe: e.target.value }));
    row.querySelector('.del-set').addEventListener('click', () => {
      DB.deleteSet(session.id, ex.id, set.id);
      const fresh = buildExerciseCard(session, DB.findExercise(session.id, ex.id));
      row.closest('.exercise').replaceWith(fresh);
    });
    return row;
  }

  // ============================================================
  // HISTORY VIEW
  // ============================================================
  function renderHistory() {
    titleEl.textContent = 'History';
    const sessions = DB.getSessions();
    const sum = DB.summary();
    const view = el('<div class="view"></div>');

    view.appendChild(el(`
      <div class="stats-row">
        <div class="stat"><span class="stat-n">${sum.sessions}</span><span class="stat-l">Sessions</span></div>
        <div class="stat"><span class="stat-n">${sum.exercises}</span><span class="stat-l">Exercises</span></div>
        <div class="stat"><span class="stat-n">${sum.totalSets}</span><span class="stat-l">Sets</span></div>
        <div class="stat"><span class="stat-n">${formatBig(sum.totalVolume)}</span><span class="stat-l">Volume (${esc(unit())})</span></div>
      </div>`));

    if (!sessions.length) {
      view.appendChild(el(`<div class="empty">No workouts logged yet.<br/><a href="#/log" class="link">Log your first one →</a></div>`));
      appEl.appendChild(view);
      return;
    }

    sessions.forEach((s) => {
      const setCount = s.exercises.reduce((a, e) => a + e.sets.length, 0);
      const vol = s.exercises.reduce((a, e) => a + e.sets.reduce((b, x) => b + x.weight * x.reps, 0), 0);
      const item = el(`
        <div class="card hist-item">
          <div class="hist-head">
            <div>
              <div class="hist-date">${esc(prettyDate(s.date))}</div>
              <div class="hist-sub">${s.exercises.length} exercises · ${setCount} sets · ${formatBig(Math.round(vol))} ${esc(unit())}</div>
            </div>
            <div class="hist-actions">
              <a class="icon-btn" href="#/log?date=${s.date}" aria-label="Edit">✏️</a>
              <button class="icon-btn del-session" aria-label="Delete">🗑️</button>
            </div>
          </div>
          <div class="hist-body">
            ${s.exercises.map((e) => `
              <div class="hist-ex">
                <span class="hist-ex-name">${esc(e.name)}</span>
                <span class="hist-ex-sets">${e.sets.map((x) => `${trimNum(x.weight)}×${x.reps}`).join(', ') || '—'}</span>
              </div>`).join('')}
            ${s.notes ? `<div class="hist-notes">📝 ${esc(s.notes)}</div>` : ''}
          </div>
        </div>`);
      item.querySelector('.del-session').addEventListener('click', () => {
        if (confirm(`Delete the workout from ${prettyDate(s.date)}?`)) {
          DB.deleteSession(s.id);
          item.remove();
          toast('Workout deleted');
        }
      });
      view.appendChild(item);
    });

    appEl.appendChild(view);
  }

  // ============================================================
  // TRENDS VIEW
  // ============================================================
  function renderTrends(query) {
    titleEl.textContent = 'Trends';
    const names = DB.exerciseNames();
    const view = el('<div class="view"></div>');

    if (!names.length) {
      view.appendChild(el(`<div class="empty">Log some workouts to see trends here.</div>`));
      appEl.appendChild(view);
      return;
    }

    const selected = query.ex && names.includes(query.ex) ? query.ex : names[0];
    const metric = query.metric || 'est1RM';

    const picker = el(`
      <div class="card trend-controls">
        <label class="field-label" for="trend-ex">Exercise</label>
        <select id="trend-ex">
          ${names.map((n) => `<option value="${esc(n)}" ${n === selected ? 'selected' : ''}>${esc(n)}</option>`).join('')}
        </select>
        <div class="seg" role="tablist">
          ${[['est1RM', 'Est. 1RM'], ['maxWeight', 'Top weight'], ['volume', 'Volume']]
            .map(([k, label]) => `<button class="seg-btn ${k === metric ? 'active' : ''}" data-metric="${k}">${label}</button>`).join('')}
        </div>
      </div>`);
    view.appendChild(picker);

    const hist = DB.exerciseHistory(selected);
    const points = hist.map((r) => ({ date: r.date, value: r[metric] }));
    const colors = { est1RM: '#5b8cff', maxWeight: '#3ddc97', volume: '#ffb454' };
    const labels = { est1RM: 'Estimated 1RM', maxWeight: 'Top set weight', volume: 'Total volume' };

    const chartCard = el(`
      <div class="card">
        <div class="chart-title">${esc(labels[metric])} <span class="muted">(${esc(unit())})</span></div>
        <div class="chart-wrap">${Charts.lineChart(points, { color: colors[metric], unit: unit(), label: labels[metric] })}</div>
      </div>`);
    view.appendChild(chartCard);

    // PRs
    const pr = DB.personalRecords(selected);
    if (pr) {
      view.appendChild(el(`
        <div class="card">
          <div class="chart-title">Personal records</div>
          <div class="pr-grid">
            <div class="pr"><span class="pr-n">${trimNum(pr.best1RM.est1RM)}</span><span class="pr-l">Best est. 1RM</span><span class="pr-d">${esc(prettyDate(pr.best1RM.date))}</span></div>
            <div class="pr"><span class="pr-n">${trimNum(pr.maxWeight.maxWeight)}</span><span class="pr-l">Heaviest set</span><span class="pr-d">${esc(prettyDate(pr.maxWeight.date))}</span></div>
            <div class="pr"><span class="pr-n">${formatBig(pr.maxVolume.volume)}</span><span class="pr-l">Most volume</span><span class="pr-d">${esc(prettyDate(pr.maxVolume.date))}</span></div>
            <div class="pr"><span class="pr-n">${pr.totalSessions}</span><span class="pr-l">Sessions</span><span class="pr-d">logged</span></div>
          </div>
        </div>`));

      // recent log table
      const recent = hist.slice().reverse().slice(0, 10);
      view.appendChild(el(`
        <div class="card">
          <div class="chart-title">Recent sessions</div>
          <table class="data-table">
            <thead><tr><th>Date</th><th>Top wt</th><th>Est 1RM</th><th>Volume</th><th>Sets</th></tr></thead>
            <tbody>
              ${recent.map((r) => `<tr>
                <td>${esc(prettyDate(r.date))}</td>
                <td>${trimNum(r.maxWeight)}</td>
                <td>${trimNum(r.est1RM)}</td>
                <td>${formatBig(r.volume)}</td>
                <td>${r.sets}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`));
    }

    // bodyweight chart
    const bw = DB.getBodyweights();
    if (bw.length) {
      const bwPoints = bw.map((b) => ({ date: b.date, value: b.value }));
      view.appendChild(el(`
        <div class="card">
          <div class="chart-title">Body weight <span class="muted">(${esc(unit())})</span></div>
          <div class="chart-wrap">${Charts.lineChart(bwPoints, { color: '#c77dff', unit: unit(), label: 'Body weight' })}</div>
        </div>`));
    }

    appEl.appendChild(view);

    picker.querySelector('#trend-ex').addEventListener('change', (e) => {
      location.hash = `#/trends?ex=${encodeURIComponent(e.target.value)}&metric=${metric}`;
    });
    picker.querySelectorAll('.seg-btn').forEach((b) => {
      b.addEventListener('click', () => {
        location.hash = `#/trends?ex=${encodeURIComponent(selected)}&metric=${b.dataset.metric}`;
      });
    });
  }

  // ============================================================
  // DATA / SETTINGS VIEW
  // ============================================================
  function renderData() {
    titleEl.textContent = 'Data';
    const settings = DB.getSettings();
    const view = el('<div class="view"></div>');

    // units
    view.appendChild(el(`
      <div class="card">
        <div class="chart-title">Units</div>
        <div class="seg">
          <button class="seg-btn ${settings.unit === 'lb' ? 'active' : ''}" data-unit="lb">lb</button>
          <button class="seg-btn ${settings.unit === 'kg' ? 'active' : ''}" data-unit="kg">kg</button>
        </div>
        <p class="muted small">Display label only — your numbers are stored as-is.</p>
      </div>`));

    // bodyweight
    const bw = DB.getBodyweights();
    const lastBw = bw[bw.length - 1];
    view.appendChild(el(`
      <div class="card">
        <div class="chart-title">Log body weight</div>
        <form id="bw-form" class="bw-form" autocomplete="off">
          <input type="date" id="bw-date" value="${DB.todayISO()}" max="${DB.todayISO()}" />
          <input type="number" id="bw-val" inputmode="decimal" step="0.1" placeholder="${lastBw ? trimNum(lastBw.value) : 'weight'}" aria-label="Body weight" />
          <button type="submit" class="primary-btn">Save</button>
        </form>
        ${bw.length ? `<p class="muted small">${bw.length} entries logged. Latest: ${trimNum(lastBw.value)} ${esc(settings.unit)} on ${esc(prettyDate(lastBw.date))}.</p>` : ''}
      </div>`));

    // backup
    view.appendChild(el(`
      <div class="card">
        <div class="chart-title">Backup & transfer</div>
        <p class="muted small">Your data lives only on this device. Export a file to back it up or move it to another device.</p>
        <div class="btn-row">
          <button class="primary-btn" id="export-btn">⬇️ Export</button>
          <button class="primary-btn" id="import-btn">⬆️ Import</button>
        </div>
        <input type="file" id="import-file" accept="application/json,.json" hidden />
      </div>`));

    // danger zone
    view.appendChild(el(`
      <div class="card danger">
        <div class="chart-title">Danger zone</div>
        <button class="danger-btn" id="clear-btn">Delete all data</button>
      </div>`));

    view.appendChild(el(`<p class="muted small center">Workout Log · works offline · install to your home screen</p>`));

    appEl.appendChild(view);

    // events
    view.querySelectorAll('[data-unit]').forEach((b) => {
      b.addEventListener('click', () => { DB.setUnit(b.dataset.unit); router(); toast('Units updated'); });
    });

    view.querySelector('#bw-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const d = view.querySelector('#bw-date').value;
      const v = view.querySelector('#bw-val').value;
      if (!v) return;
      DB.logBodyweight(d, v);
      toast('Body weight logged');
      router();
    });

    view.querySelector('#export-btn').addEventListener('click', exportData);
    view.querySelector('#import-btn').addEventListener('click', () => view.querySelector('#import-file').click());
    view.querySelector('#import-file').addEventListener('change', importData);

    view.querySelector('#clear-btn').addEventListener('click', () => {
      if (confirm('Delete ALL workouts and body-weight data? This cannot be undone.') &&
          confirm('Really sure? Consider exporting a backup first.')) {
        DB.clearAll();
        toast('All data deleted');
        router();
      }
    });
  }

  function exportData() {
    const blob = new Blob([DB.exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workout-log-${DB.todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('Exported backup file');
  }

  function importData(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const mode = confirm('OK = MERGE with current data.\nCancel = REPLACE everything with the file.') ? 'merge' : 'replace';
        DB.importJSON(reader.result, mode);
        toast(`Imported (${mode})`);
        router();
      } catch (err) {
        alert('Could not import: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  // ---------- misc formatting ----------
  function formatBig(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 10000) return (n / 1000).toFixed(1) + 'k';
    return Math.round(n).toLocaleString();
  }

  // ---------- PWA install + service worker ----------
  let deferredPrompt = null;
  const installBtn = document.getElementById('install-btn');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.hidden = false;
  });
  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.hidden = true;
  });
  window.addEventListener('appinstalled', () => { installBtn.hidden = true; });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW registration failed', err));
    });
  }

  // ============================================================
  // PROGRAM (parsed from the Markdown training plan -> data/program.json)
  // ============================================================
  let PROGRAM = null;

  // History names first (most personal), then program names alphabetically.
  function allExerciseNames() {
    const fromHistory = DB.exerciseNames();
    const have = new Set(fromHistory);
    const extra = [];
    if (PROGRAM && PROGRAM.exerciseNames) {
      for (const n of PROGRAM.exerciseNames) if (!have.has(n)) { have.add(n); extra.push(n); }
    }
    extra.sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));
    return fromHistory.concat(extra);
  }

  async function loadProgram() {
    try {
      const res = await fetch('data/program.json', { cache: 'force-cache' });
      if (!res.ok) throw new Error('no program');
      PROGRAM = await res.json();
      if (currentRoute().path === '/log') router(); // reveal the program button
    } catch (e) {
      PROGRAM = null; // still fully usable as a free-form logger
    }
  }

  // Modal: pick a week + session, then add its exercises to `date`.
  function openProgramPicker(date) {
    if (!PROGRAM || !PROGRAM.weeks || !PROGRAM.weeks.length) { toast('Program not loaded'); return; }
    const lastWeek = localStorage.getItem('workoutlog.lastWeek');
    let weekIdx = PROGRAM.weeks.findIndex((w) => String(w.week) === lastWeek);
    if (weekIdx < 0) weekIdx = 0;

    const overlay = el('<div class="modal-overlay"></div>');
    const modal = el(`
      <div class="modal" role="dialog" aria-label="Load from program">
        <div class="modal-head">
          <h3>Load from program</h3>
          <button class="icon-btn modal-close" aria-label="Close">✕</button>
        </div>
        <label class="field-label" for="pp-week">Week</label>
        <select id="pp-week"></select>
        <label class="field-label" for="pp-session">Session</label>
        <select id="pp-session"></select>
        <div id="pp-preview" class="pp-preview"></div>
        <button class="primary-btn" id="pp-add">Add to ${esc(prettyDate(date))}</button>
      </div>`);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const weekSel = modal.querySelector('#pp-week');
    const sessSel = modal.querySelector('#pp-session');
    const preview = modal.querySelector('#pp-preview');

    weekSel.innerHTML = PROGRAM.weeks.map((w, i) =>
      `<option value="${i}" ${i === weekIdx ? 'selected' : ''}>Week ${w.week}${w.block ? ' · Block ' + w.block : ''}</option>`).join('');

    function fillSessions() {
      const w = PROGRAM.weeks[Number(weekSel.value)];
      sessSel.innerHTML = w.sessions.map((s, i) => `<option value="${i}">${esc(s.title)}</option>`).join('');
      fillPreview();
    }
    function fillPreview() {
      const w = PROGRAM.weeks[Number(weekSel.value)];
      const s = w.sessions[Number(sessSel.value)];
      preview.innerHTML = s.exercises.map((e) =>
        `<div class="pp-ex"><span>${e.code ? esc(e.code) + ') ' : ''}${esc(e.name)}</span><span class="muted">${esc(e.scheme || (e.sets + ' sets'))}</span></div>`).join('');
    }
    weekSel.addEventListener('change', fillSessions);
    sessSel.addEventListener('change', fillPreview);
    fillSessions();

    function close() { overlay.remove(); }
    modal.querySelector('.modal-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    modal.querySelector('#pp-add').addEventListener('click', () => {
      const w = PROGRAM.weeks[Number(weekSel.value)];
      const s = w.sessions[Number(sessSel.value)];
      localStorage.setItem('workoutlog.lastWeek', String(w.week));
      const session = DB.getOrCreateSession(date);
      for (const e of s.exercises) {
        DB.addExercise(session.id, e.name, {
          scheme: e.scheme || null, tempo: e.tempo || null, sets: e.sets || null, code: e.code || null,
        });
      }
      close();
      toast(`Added ${s.exercises.length} exercises`);
      router();
    });
  }

  // ---------- boot ----------
  if (!location.hash) location.hash = '#/log';
  router();
  loadProgram();
})();

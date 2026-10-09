// app.js — the brain of the tracker.
//
// How the whole thing works:
//   1. On load, we read your GitHub token from this browser (localStorage).
//   2. We download data.json from your PRIVATE repo through the GitHub API.
//   3. `state` holds that data in memory. The views turn `state` into HTML.
//   4. When you change something, we update `state`, redraw the screen, and a
//      moment later save the whole file back to GitHub (each save = one commit).
//
// Files:
//   github.js    talks to GitHub (read + write data.json)
//   markdown.js  turns note text into formatted HTML
//   dates.js     date helpers
//   views/*.js   one file per screen; each one returns an HTML string

import { getRepo, readFile, writeFile } from './github.js';
import { renderMarkdown, toggleTask } from './markdown.js';
import { todayISO, isISODate, fromISO, formatShort } from './dates.js';
import { STATUS, NEXT_STATUS, CATS } from './constants.js';
import { esc, ICONS } from './views/ui.js';
import { renderHome } from './views/home.js';
import { renderBoard } from './views/board.js';
import { renderCalendar } from './views/calendar.js';
import { renderNotes } from './views/notes.js';

const VIEWS = { home: renderHome, board: renderBoard, calendar: renderCalendar, notes: renderNotes };
const TABS = [['home', 'Home'], ['board', 'Board'], ['calendar', 'Calendar'], ['notes', 'Notes']];

// The only things kept in this browser's localStorage (never your data itself)
const KEY = { config: 'tracker.config', token: 'tracker.token', hideDone: 'tracker.hideDone' };

const root = document.getElementById('root');

// ===========================================================================
// 1. State
// ===========================================================================

let state = null; // everything in data.json: inbox, events, sections, pages
let cfg = null; // { owner, repo, path, branch }
let token = null; // your fine-grained GitHub token

// Bookkeeping for saving to GitHub
const sync = {
  sha: null, // GitHub's fingerprint of the version we have
  oldShas: new Set(), // versions we already replaced (so a slow, stale read can't undo a save)
  savedText: '', // exact text of the last save, so we skip saves that change nothing
  dirty: false, // true = there are changes GitHub doesn't have yet
  saving: false,
  timer: null,
  retries: 0,
  lastSaved: 0,
  lastFetch: 0,
  conflict: false, // the file changed somewhere else; you choose what to keep
  blocked: null, // { message, needsToken } when GitHub refuses to save
  status: 'saved',
};

// Screen-only state: what's open, which month… This is never saved to GitHub.
const startDay = todayISO();
const ui = {
  view: 'home',
  openTickets: new Set(),
  editTicketNotes: new Set(),
  editSection: null,
  hideDone: readLocal(KEY.hideDone) === '1',
  calY: fromISO(startDay).getFullYear(),
  calM: fromISO(startDay).getMonth(),
  day: startDay,
  editEvent: null,
  pageId: null,
  editPage: false,
  notesQuery: '',
  datingThought: null,
  settingsOpen: false,
  disconnectArmed: false,
  focusAfter: null, // { id, select } — field to focus after the next redraw
  scrollTo: null, // element id to scroll to after the next redraw
};

// localStorage can throw (private windows, blocked storage), so always wrap it
function readLocal(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the app still works, it just won't remember this */
  }
}

// Read a form field by name. (form.title would give the form's own "title"
// attribute in some cases, so we always go through form.elements.)
function field(form, name) {
  return form.elements.namedItem(name);
}

// Short unique ids like "e1k2j3ab9x"
function uid(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ---------------------------------------------------------------------------
// normalize(): clean up whatever is in data.json so the rest of the code can
// trust it (missing lists become [], unknown statuses become "todo", …).
// This is what keeps a hand-edited or older file from crashing the app.
// ---------------------------------------------------------------------------
function normalize(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const list = (v) => (Array.isArray(v) ? v : []);
  const text = (v) => (typeof v === 'string' ? v : '');

  const sections = (Array.isArray(d.sections) ? d.sections : [{ id: 'TODO', title: 'To do' }]).map((s) => {
    const section = {
      id: text(s.id) || uid('S'),
      title: text(s.title) || 'Untitled',
      blurb: text(s.blurb),
      later: !!s.later,
      items: [],
    };
    list(s.items).forEach((t, n) => {
      section.items.push({
        id: text(t.id) || `${section.id}-${n + 1}`,
        title: text(t.title),
        status: STATUS[t.status] ? t.status : 'todo',
        note: text(t.note),
        due: isISODate(t.due) ? t.due : '',
        steps: list(t.steps).map((x) => ({ t: text(x.t), done: !!x.done })),
        notes: text(t.notes),
      });
    });
    return section;
  });

  return {
    version: 1,
    inbox: list(d.inbox)
      .filter((t) => t && typeof t.text === 'string')
      .map((t) => ({ id: text(t.id) || uid('h'), text: t.text, created: text(t.created) || new Date().toISOString() })),
    events: list(d.events)
      .filter((e) => e && isISODate(e.date))
      .map((e) => ({
        id: text(e.id) || uid('e'),
        title: text(e.title),
        date: e.date,
        time: /^\d{2}:\d{2}$/.test(e.time) ? e.time : '',
        cat: CATS[e.cat] ? e.cat : 'life',
        note: text(e.note),
        done: !!e.done,
      })),
    sections,
    pages: list(d.pages).map((p) => ({
      id: text(p.id) || uid('p'),
      title: text(p.title),
      folder: text(p.folder) || 'General',
      body: text(p.body),
      updated: isISODate(p.updated) ? p.updated : todayISO(),
    })),
  };
}

// Pretty-printed with 2 spaces so the file is readable on GitHub and diffs line by line
function serialize() {
  return `${JSON.stringify(state, null, 2)}\n`;
}

// --- Lookups ---------------------------------------------------------------
function findTicket(id) {
  for (const section of state.sections) {
    const ticket = section.items.find((t) => t.id === id);
    if (ticket) return { section, ticket };
  }
  return null;
}
const findSection = (id) => state.sections.find((s) => s.id === id);
const findEvent = (id) => state.events.find((e) => e.id === id);
const findPage = (id) => state.pages.find((p) => p.id === id);
const findPageByTitle = (title) => {
  const wanted = title.trim().toLowerCase();
  return state.pages.find((p) => p.title.trim().toLowerCase() === wanted) || null;
};

// Next free ticket id in a section: JOB-1, JOB-2, … (never reuses an id that exists anywhere)
function nextTicketId(section) {
  let n = 0;
  section.items.forEach((t) => {
    const num = Number(String(t.id).split('-').pop());
    if (num > n) n = num;
  });
  let id;
  do id = `${section.id}-${++n}`;
  while (findTicket(id));
  return id;
}

// Section prefix from its name: "Grad school" -> "GRA" (then GRA2, GRA3 if taken)
function newSectionId(title) {
  const base = title.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'SEC';
  let id = base;
  let n = 2;
  while (findSection(id)) id = base + n++;
  return id;
}

function addTicket(section, title) {
  const ticket = { id: nextTicketId(section), title, status: 'todo', note: '', due: '', steps: [], notes: '' };
  section.items.push(ticket);
  return ticket;
}

function addPage(title, folder, body = '') {
  const page = { id: uid('p'), title, folder: folder || 'General', body, updated: todayISO() };
  state.pages.push(page);
  return page;
}

// A thought's first line becomes a title; anything after it becomes notes
function splitThought(text) {
  const [first, ...rest] = text.split('\n');
  const title = first.trim();
  if (title.length <= 140) return { title, extra: rest.join('\n').trim() };
  return { title: `${title.slice(0, 137)}…`, extra: text.trim() };
}

// ===========================================================================
// 2. Drawing the screen
// ===========================================================================

function ctx() {
  return {
    state,
    ui,
    today: todayISO(),
    md: (src, source) => renderMarkdown(src, { source, findPage: findPageByTitle }),
  };
}

function showApp() {
  root.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <a class="brand" href="#home"><span class="brand-mark" aria-hidden="true"></span>Tracker</a>
        <nav class="tabs" aria-label="Main">
          ${TABS.map(([key, label]) => `<a class="tab" href="#${key}" data-tab="${key}">${ICONS[key]}<span>${label}</span></a>`).join('')}
        </nav>
        <div class="top-right">
          <span class="sync" id="sync" role="status"></span>
          <button type="button" class="icon-btn" data-act="settings-open" aria-label="Settings">${ICONS.settings}</button>
        </div>
      </header>
      <div id="banner"></div>
      <main id="view" class="view"></main>
    </div>`;
  lastBanner = '';
  setStatus(sync.status);
  route();
}

// Redraw the current screen without losing your place: we remember which field
// had focus, where the cursor was, the scroll position, and half-typed text in
// the "Add…" boxes, then put all of that back after the new HTML is in.
function renderView({ keepScroll = true } = {}) {
  const view = document.getElementById('view');
  if (!view || !state) return;

  const active = document.activeElement;
  const focusId = active && view.contains(active) ? active.id : null;
  let cursor = null;
  try {
    if (focusId && typeof active.selectionStart === 'number') cursor = [active.selectionStart, active.selectionEnd];
  } catch {
    /* some input types (date, checkbox) have no cursor */
  }
  const drafts = {};
  view.querySelectorAll('input[id], textarea[id], select[id]').forEach((el) => {
    if (!el.dataset.field && !el.dataset.act && el.type !== 'checkbox') drafts[el.id] = el.value;
  });
  const y = window.scrollY;

  view.innerHTML = VIEWS[ui.view](ctx());

  Object.entries(drafts).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el && view.contains(el)) el.value = value;
  });
  view.querySelectorAll('textarea').forEach(autosize);

  if (ui.focusAfter) {
    const el = document.getElementById(ui.focusAfter.id);
    if (el) {
      el.focus({ preventScroll: true });
      if (ui.focusAfter.select && el.select) el.select();
    }
    ui.focusAfter = null;
  } else if (focusId) {
    const el = document.getElementById(focusId);
    if (el) {
      el.focus({ preventScroll: true });
      if (cursor) {
        try {
          el.setSelectionRange(cursor[0], cursor[1]);
        } catch {
          /* not a text field */
        }
      }
    }
  }

  if (ui.scrollTo) {
    const el = document.getElementById(ui.scrollTo);
    ui.scrollTo = null;
    if (el) el.scrollIntoView({ block: 'center' });
  } else {
    window.scrollTo(0, keepScroll ? y : 0);
  }
  renderBanner();
}

// Grow a textarea to fit its text, so you never scroll inside a tiny box
function autosize(el) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight + 2}px`;
}

// Something changed: redraw now, save to GitHub shortly
function changed(delay) {
  renderView();
  markDirty(delay);
}

// Update just the text of elements that mirror a field (e.g. a ticket's title in its
// row while you type in its Title box), without redrawing and stealing your focus.
function syncText(kind, id, field, value) {
  const key = CSS.escape(`${kind}:${id}:${field}`);
  document.querySelectorAll(`[data-sync="${key}"]`).forEach((el) => {
    el.textContent = value || 'Untitled';
  });
}

// --- Routing: the part after # in the address bar picks the screen ----------
//   #home   #board   #board/JOB-1   #calendar   #calendar/2026-10-10   #notes   #notes/<page id>
function route() {
  if (!state) return;
  const raw = decodeURIComponent(location.hash.replace(/^#/, ''));
  const [name, ...rest] = raw.split('/');
  const arg = rest.join('/');
  ui.view = VIEWS[name] ? name : 'home';

  if (ui.view === 'board' && arg) {
    ui.openTickets.add(arg);
    ui.scrollTo = `t-${arg}`;
  }
  if (ui.view === 'calendar' && isISODate(arg)) selectDay(arg);
  if (ui.view === 'notes') {
    const id = arg || null;
    if (id !== ui.pageId) ui.editPage = false;
    ui.pageId = id;
  }

  document.querySelectorAll('.tab').forEach((tab) => {
    const on = tab.dataset.tab === ui.view;
    tab.classList.toggle('is-active', on);
    if (on) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
  document.title = `${TABS.find(([key]) => key === ui.view)[1]} · Tracker`;
  renderView({ keepScroll: false });
}
window.addEventListener('hashchange', route);

function selectDay(iso) {
  ui.day = iso;
  const d = fromISO(iso);
  ui.calY = d.getFullYear();
  ui.calM = d.getMonth();
}

// ===========================================================================
// 3. Saving to GitHub
// ===========================================================================

const STATUS_TEXT = {
  saved: 'Saved',
  pending: 'Unsaved',
  saving: 'Saving…',
  error: 'Retrying…',
  offline: 'Offline',
  conflict: 'Not saved',
  blocked: 'Not saved',
};

function setStatus(kind) {
  sync.status = kind;
  const el = document.getElementById('sync');
  if (!el) return;
  el.className = `sync sync-${kind}`;
  el.innerHTML = `<span class="sync-dot"></span><span class="sync-text">${STATUS_TEXT[kind]}</span>`;
  el.title = kind === 'saved' && sync.lastSaved ? `Saved to GitHub at ${new Date(sync.lastSaved).toLocaleTimeString()}` : '';
}

// Wait a moment after your last change, then save. Typing waits longer, so a
// paragraph of notes becomes one commit instead of fifty.
function markDirty(delay = 1200) {
  if (!state) return;
  sync.dirty = true;
  if (sync.conflict || sync.blocked) {
    renderBanner();
    return;
  }
  setStatus('pending');
  clearTimeout(sync.timer);
  sync.timer = setTimeout(saveNow, delay);
}

async function saveNow() {
  clearTimeout(sync.timer);
  if (!sync.dirty || sync.conflict || sync.blocked) return;
  if (sync.saving) {
    sync.timer = setTimeout(saveNow, 600); // one save at a time
    return;
  }
  const text = serialize();
  if (text === sync.savedText) {
    sync.dirty = false;
    setStatus('saved');
    return;
  }
  sync.saving = true;
  sync.dirty = false;
  setStatus('saving');
  try {
    const newSha = await writeFile(cfg, token, text, sync.sha, 'Update from tracker');
    if (sync.sha) sync.oldShas.add(sync.sha);
    sync.sha = newSha;
    sync.savedText = text;
    sync.lastSaved = Date.now();
    sync.retries = 0;
    setStatus(sync.dirty ? 'pending' : 'saved');
  } catch (err) {
    sync.dirty = true;
    handleSaveError(err);
  } finally {
    sync.saving = false;
    // You kept editing while we were saving: save again
    if (sync.dirty && !sync.conflict && !sync.blocked && sync.status === 'pending') {
      clearTimeout(sync.timer);
      sync.timer = setTimeout(saveNow, 800);
    }
  }
}

function handleSaveError(err) {
  const s = err.status;
  if (s === 409 || (s === 422 && /sha/i.test(err.message))) {
    sync.conflict = true;
    setStatus('conflict');
  } else if (s === 401) {
    sync.blocked = { message: 'GitHub stopped accepting your token. It probably expired or was deleted.', needsToken: true };
    setStatus('blocked');
  } else if ((s === 403 || s === 429) && /rate limit/i.test(err.message)) {
    retryLater(60000);
  } else if (s === 403 || s === 404) {
    sync.blocked = {
      message: 'Your token can read your data but isn’t allowed to save it. Make a token with “Contents: Read and write” on your data repo.',
      needsToken: true,
    };
    setStatus('blocked');
  } else if (s === 422) {
    sync.blocked = { message: `GitHub refused the save: ${err.message}`, needsToken: false };
    setStatus('blocked');
  } else {
    retryLater(); // network trouble or GitHub hiccup: wait and try again
  }
  renderBanner();
}

function retryLater(ms) {
  sync.retries++;
  const wait = ms || Math.min(60000, 2000 * 2 ** sync.retries); // 4s, 8s, 16s… up to a minute
  setStatus(navigator.onLine === false ? 'offline' : 'error');
  clearTimeout(sync.timer);
  sync.timer = setTimeout(saveNow, wait);
}

// Warnings that sit above the screen when a save can't go through
let lastBanner = '';
function renderBanner() {
  const el = document.getElementById('banner');
  if (!el) return;
  let html = '';
  if (sync.conflict) {
    html = `
      <div class="banner warn" role="alert">
        <p><strong>Your data changed somewhere else</strong> (another tab or device) after this page loaded. Your newest edits here aren’t saved yet.</p>
        <div class="row-actions">
          <button type="button" class="primary-btn small" data-act="conflict-keep">Keep this version (overwrites the other)</button>
          <button type="button" class="ghost-btn small" data-act="conflict-load">Load the other one (drops edits made here)</button>
        </div>
      </div>`;
  } else if (sync.blocked) {
    html = `
      <div class="banner danger" role="alert">
        <p><strong>Not saved.</strong> ${esc(sync.blocked.message)} Your edits are still on screen.</p>
        ${sync.blocked.needsToken
          ? `<form class="inline-form" data-form="retoken">
               <label class="sr" for="retoken">New token</label>
               <input type="password" id="retoken" name="token" placeholder="Paste a new token" autocomplete="off" required>
               <button type="submit" class="primary-btn small">Save with new token</button>
             </form>`
          : '<div class="row-actions"><button type="button" class="ghost-btn small" data-act="retry">Try again</button></div>'}
      </div>`;
  }
  if (html !== lastBanner || !el.firstChild !== !html) {
    el.innerHTML = html;
    lastBanner = html;
  }
}

// Pick up changes you made on another device when you come back to this tab
async function refreshFromGitHub() {
  if (!state || !token) return;
  const now = Date.now();
  if (sync.dirty || sync.saving || sync.conflict || sync.blocked) return;
  if (now - sync.lastSaved < 15000 || now - sync.lastFetch < 8000) return;
  sync.lastFetch = now;
  try {
    const file = await readFile(cfg, token);
    if (file.sha === sync.sha || sync.oldShas.has(file.sha)) return; // nothing new
    if (sync.dirty || sync.saving) return; // you started editing meanwhile; don't overwrite it
    state = normalize(JSON.parse(file.text));
    sync.sha = file.sha;
    sync.savedText = file.text;
    renderView();
    toast('Updated with changes from another device');
  } catch {
    /* quiet: we'll try again next time you come back */
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshFromGitHub();
  else if (sync.dirty) saveNow(); // leaving the tab: save right away
});
window.addEventListener('focus', refreshFromGitHub);
window.addEventListener('online', () => {
  if (sync.dirty) saveNow();
});
window.addEventListener('beforeunload', (e) => {
  if (sync.dirty || sync.saving) {
    e.preventDefault(); // "Leave site? Changes may not be saved."
    e.returnValue = '';
  }
});

// ===========================================================================
// 4. Connecting (first visit, or after "Disconnect")
// ===========================================================================

function guessOwner() {
  // On GitHub Pages the address is <username>.github.io, so we can prefill your username
  const host = location.hostname;
  return host.endsWith('.github.io') ? host.split('.')[0] : '';
}

function showConnect(message = '', isError = false) {
  const c = cfg || { owner: guessOwner(), repo: 'tracker-data', path: 'data.json' };
  document.title = 'Tracker';
  root.innerHTML = `
    <div class="connect">
      <div class="connect-card">
        <p class="eyebrow">Private tracker</p>
        <h1>Tracker</h1>
        <p class="lede">Your tickets, dates, thoughts and notes live in a <strong>private</strong> GitHub repo. This page is only the window. Paste a token that can open that repo. It stays in this browser and is only ever sent to GitHub.</p>
        <form class="stack" data-form="connect" autocomplete="off">
          <label class="field"><span>GitHub username</span><input id="c-owner" name="owner" value="${esc(c.owner)}" required autocapitalize="off" spellcheck="false"></label>
          <label class="field"><span>Private data repo</span><input id="c-repo" name="repo" value="${esc(c.repo)}" required autocapitalize="off" spellcheck="false"></label>
          <label class="field"><span>Data file</span><input id="c-path" name="path" value="${esc(c.path)}" required autocapitalize="off" spellcheck="false"></label>
          <label class="field"><span>Token</span><input id="c-token" name="token" type="password" required placeholder="github_pat_…" autocomplete="off"></label>
          <button class="primary-btn" type="submit">Connect</button>
          <p class="connect-msg${isError ? ' is-error' : ''}" id="connect-msg" role="status">${esc(message)}</p>
        </form>
        <details class="help">
          <summary>How to make the token</summary>
          <ol>
            <li>On GitHub: your profile picture → <b>Settings</b> → <b>Developer settings</b> → <b>Personal access tokens</b> → <b>Fine-grained tokens</b> → <b>Generate new token</b>.</li>
            <li>Repository access: <b>Only select repositories</b>, then pick your private data repo.</li>
            <li>Permissions → Repository permissions → <b>Contents</b>: <b>Read and write</b>.</li>
            <li>Generate it, copy it, and paste it above. GitHub shows it only once.</li>
          </ol>
        </details>
      </div>
    </div>`;
}

async function connectSubmit(form) {
  const msg = document.getElementById('connect-msg');
  const button = form.querySelector('button[type="submit"]');
  const say = (text, bad) => {
    msg.textContent = text;
    msg.classList.toggle('is-error', !!bad);
  };
  cfg = {
    owner: field(form, 'owner').value.trim(),
    repo: field(form, 'repo').value.trim(),
    path: field(form, 'path').value.trim().replace(/^\/+/, '') || 'data.json',
    branch: 'main',
  };
  token = field(form, 'token').value.trim();
  button.disabled = true;
  say('Checking with GitHub…');
  try {
    const info = await getRepo(cfg, token);
    if (!info.private) {
      say(`${cfg.owner}/${cfg.repo} is public, so anyone could read your data. Make it private first (the repo's Settings → General → Danger Zone → Change visibility), then connect again.`, true);
      button.disabled = false;
      return;
    }
    cfg.branch = info.default_branch || 'main';
    await loadData({ createIfMissing: true });
    writeLocal(KEY.config, JSON.stringify(cfg));
    writeLocal(KEY.token, token);
    showApp();
  } catch (err) {
    say(explain(err), true);
    button.disabled = false;
  }
}

async function loadData({ createIfMissing = false } = {}) {
  let file;
  try {
    file = await readFile(cfg, token);
  } catch (err) {
    if (err.status === 404 && createIfMissing) {
      // Brand-new repo: start an empty tracker file
      state = normalize({});
      const text = serialize();
      sync.sha = await writeFile(cfg, token, text, null, 'Create tracker data');
      sync.savedText = text;
      return;
    }
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(file.text);
  } catch {
    const err = new Error(`${cfg.path} isn't valid JSON, so it wasn't loaded (and nothing was overwritten). Fix it on GitHub, or restore an older version from the file's history.`);
    err.status = 'json';
    throw err;
  }
  state = normalize(parsed);
  sync.sha = file.sha;
  sync.savedText = file.text;
  sync.lastFetch = Date.now();
}

function explain(err) {
  const where = cfg ? `${cfg.owner}/${cfg.repo}` : 'the repo';
  if (err.status === 'json') return err.message;
  if (err.status === 401) return 'GitHub didn’t accept that token. Check that you copied all of it and that it hasn’t expired.';
  if (err.status === 404) return `Couldn’t open ${where} (${cfg?.path}) with this token. Check the spelling, and that the token was given access to this repo.`;
  if (err.status === 403) return `GitHub said no (403): ${err.message}`;
  if (err.status === 0) return 'Couldn’t reach GitHub. Check your internet connection.';
  return `Something went wrong: ${err.message || err.status}`;
}

// ===========================================================================
// 5. Settings, toasts, undo
// ===========================================================================

function renderSettings() {
  const el = document.getElementById('modal-root');
  if (!ui.settingsOpen) {
    el.innerHTML = '';
    return;
  }
  const history = `https://github.com/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/commits/${encodeURIComponent(cfg.branch || 'main')}/${cfg.path.split('/').map(encodeURIComponent).join('/')}`;
  el.innerHTML = `
    <div class="modal-backdrop" data-act="settings-close"></div>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="set-h">
      <div class="modal-head">
        <h2 id="set-h">Settings</h2>
        <button type="button" class="icon-btn" id="settings-x" data-act="settings-close" aria-label="Close">×</button>
      </div>
      <p class="kv"><span>Your data</span><code>${esc(cfg.owner)}/${esc(cfg.repo)}/${esc(cfg.path)}</code></p>
      <div class="stack">
        <a class="ghost-btn" href="${esc(history)}" target="_blank" rel="noopener noreferrer">See every saved change on GitHub</a>
        <button type="button" class="ghost-btn" data-act="reload">Reload from GitHub</button>
        <button type="button" class="ghost-btn" data-act="backup">Download a backup</button>
        <button type="button" class="danger-btn" data-act="disconnect">${ui.disconnectArmed ? 'Click again to disconnect' : 'Disconnect this browser'}</button>
      </div>
      <p class="hint">Disconnect removes your token from this browser only. Your data stays on GitHub. You'll need a token to connect again, so keep it in your password manager.</p>
    </div>`;
}

let toastTimer = null;
let undoSnapshot = null;

// A small message at the bottom. Pass a snapshot to offer "Undo".
function toast(message, snapshot) {
  const el = document.getElementById('toast');
  undoSnapshot = snapshot || null;
  el.innerHTML = `<span>${esc(message)}</span>${snapshot ? '<button type="button" data-act="undo">Undo</button>' : ''}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
    undoSnapshot = null;
  }, snapshot ? 7000 : 3000);
}

// A copy of everything, taken right before a delete, so Undo can put it back
function snapshot() {
  return JSON.stringify(state);
}

function downloadBackup() {
  const blob = new Blob([serialize()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tracker-backup-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ===========================================================================
// 6. Reacting to what you do
// Every button has data-act="something"; one listener looks it up in a table.
// (This is called event delegation: one listener for the whole page instead of
// one per button, so it keeps working after every redraw.)
// ===========================================================================

// Fields typed into (title, notes…) save as you type, without redrawing.
// Dates count too: redrawing in the middle of typing a date would kick you out of it.
const isTextLike = (el) => el.tagName === 'TEXTAREA' || ['text', 'search', 'time', 'date', 'url', ''].includes(el.type);

// Write a field's new value into state. Used by every data-field input.
function setField(el) {
  const { kind, id, field, k } = el.dataset;
  const value = el.type === 'checkbox' ? el.checked : el.value;

  if (kind === 'ticket') {
    const found = findTicket(id);
    if (!found) return;
    if (field === 'section') {
      moveTicket(found, value);
    } else if (field === 'due') {
      found.ticket.due = isISODate(value) ? value : '';
    } else {
      found.ticket[field] = value;
    }
  } else if (kind === 'step') {
    const found = findTicket(id);
    if (found && found.ticket.steps[k]) found.ticket.steps[k].t = value;
  } else if (kind === 'event') {
    const e = findEvent(id);
    if (!e) return;
    if (field === 'date') {
      if (!isISODate(value)) return; // half-typed date: wait for a full one
      e.date = value;
      selectDay(value); // follow the date to its new day
    } else {
      e[field] = value;
    }
  } else if (kind === 'page') {
    const p = findPage(id);
    if (!p) return;
    p[field] = value;
    p.updated = todayISO();
  } else if (kind === 'section') {
    const s = findSection(id);
    if (s) s[field] = value;
  }
  if (typeof value === 'string' && isTextLike(el)) syncText(kind, id, field, value);
  markDirty(isTextLike(el) ? 2500 : 1200);
}

// Moving a ticket to another section gives it a new id there (JOB-6 -> SCH-3)
function moveTicket(found, sectionId) {
  const target = findSection(sectionId);
  if (!target || target === found.section) return;
  const oldId = found.ticket.id;
  found.section.items.splice(found.section.items.indexOf(found.ticket), 1);
  found.ticket.id = nextTicketId(target);
  target.items.push(found.ticket);
  ui.openTickets.delete(oldId);
  ui.openTickets.add(found.ticket.id);
  if (ui.editTicketNotes.delete(oldId)) ui.editTicketNotes.add(found.ticket.id);
  ui.scrollTo = `t-${found.ticket.id}`;
  toast(`Moved to ${target.title} as ${found.ticket.id}`);
}

// Ticking a step also moves the ticket along: first tick -> In progress, all ticked -> Done
function stepCheck(el) {
  const found = findTicket(el.dataset.id);
  if (!found) return;
  const t = found.ticket;
  t.steps[Number(el.dataset.k)].done = el.checked;
  const allDone = t.steps.every((x) => x.done);
  if (allDone && t.status !== 'closed') t.status = 'done';
  else if (el.checked && t.status === 'todo') t.status = 'doing';
  else if (!el.checked && t.status === 'done') t.status = 'doing';
  changed();
}

function thoughtMove(el) {
  const choice = el.value;
  const id = el.dataset.id;
  el.value = '';
  const thought = state.inbox.find((t) => t.id === id);
  if (!thought || !choice) return;
  if (choice === 'date') {
    ui.datingThought = id;
    ui.focusAfter = { id: `thd-${id}` };
    renderView();
    return;
  }
  const before = snapshot();
  const { title, extra } = splitThought(thought.text);
  state.inbox = state.inbox.filter((t) => t.id !== id);
  if (choice === 'note') {
    addPage(title, 'Thoughts', extra);
    changed();
    toast('Saved as a note in the Thoughts folder', before);
  } else if (choice.startsWith('ticket:')) {
    const section = findSection(choice.slice(7));
    if (!section) return;
    const t = addTicket(section, title);
    t.notes = extra;
    changed();
    toast(`Added ${t.id} to ${section.title}`, before);
  }
}

// Buttons and links (anything clickable that isn't a form field)
const CLICK = {
  cycle(el) {
    const found = findTicket(el.dataset.id);
    if (!found) return;
    found.ticket.status = NEXT_STATUS[found.ticket.status] || 'todo';
    changed();
  },
  'ticket-toggle'(el) {
    const id = el.dataset.id;
    if (ui.openTickets.has(id)) ui.openTickets.delete(id);
    else ui.openTickets.add(id);
    renderView();
  },
  'ticket-notes-edit'(el) {
    const id = el.dataset.id;
    if (ui.editTicketNotes.has(id)) ui.editTicketNotes.delete(id);
    else {
      ui.editTicketNotes.add(id);
      ui.focusAfter = { id: `tnotes-${id}` };
    }
    renderView();
  },
  'ticket-due-clear'(el) {
    const found = findTicket(el.dataset.id);
    if (found) found.ticket.due = '';
    changed();
  },
  'ticket-del'(el) {
    const found = findTicket(el.dataset.id);
    if (!found) return;
    const before = snapshot();
    found.section.items.splice(found.section.items.indexOf(found.ticket), 1);
    ui.openTickets.delete(found.ticket.id);
    changed();
    toast(`Deleted ${found.ticket.id}`, before);
  },
  'step-del'(el) {
    const found = findTicket(el.dataset.id);
    if (!found) return;
    const before = snapshot();
    found.ticket.steps.splice(Number(el.dataset.k), 1);
    changed();
    toast('Step removed', before);
  },
  'section-edit'(el) {
    ui.editSection = ui.editSection === el.dataset.id ? null : el.dataset.id;
    if (ui.editSection) ui.focusAfter = { id: `se-title-${el.dataset.id}` };
    renderView();
  },
  'section-move'(el) {
    const i = state.sections.findIndex((s) => s.id === el.dataset.id);
    const j = i + Number(el.dataset.dir);
    if (i < 0 || j < 0 || j >= state.sections.length) return;
    [state.sections[i], state.sections[j]] = [state.sections[j], state.sections[i]];
    changed();
  },
  'section-del'(el) {
    const s = findSection(el.dataset.id);
    if (!s) return;
    const before = snapshot();
    state.sections = state.sections.filter((x) => x !== s);
    ui.editSection = null;
    changed();
    toast(`Deleted section “${s.title}”${s.items.length ? ` and its ${s.items.length} tickets` : ''}`, before);
  },
  'event-edit'(el) {
    ui.editEvent = ui.editEvent === el.dataset.id ? null : el.dataset.id;
    renderView();
  },
  'event-del'(el) {
    const e = findEvent(el.dataset.id);
    if (!e) return;
    const before = snapshot();
    state.events = state.events.filter((x) => x !== e);
    ui.editEvent = null;
    changed();
    toast(`Deleted “${e.title || 'Untitled'}”`, before);
  },
  'cal-move'(el) {
    const d = new Date(ui.calY, ui.calM + Number(el.dataset.dir), 1);
    ui.calY = d.getFullYear();
    ui.calM = d.getMonth();
    renderView();
  },
  'cal-today'() {
    selectDay(todayISO());
    renderView();
  },
  'cal-day'(el) {
    selectDay(el.dataset.date);
    ui.editEvent = null;
    history.replaceState(null, '', `#calendar/${el.dataset.date}`); // reload keeps the day
    renderView();
    if (window.matchMedia('(max-width: 960px)').matches) {
      document.querySelector('.day-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  },
  'thought-del'(el) {
    const before = snapshot();
    state.inbox = state.inbox.filter((t) => t.id !== el.dataset.id);
    changed();
    toast('Thought cleared', before);
  },
  'thought-date-cancel'() {
    ui.datingThought = null;
    renderView();
  },
  'page-new'() {
    const current = ui.pageId && findPage(ui.pageId);
    const page = addPage('Untitled', current ? current.folder : 'General');
    ui.pageId = page.id; // set first, so the route change below keeps edit mode on
    ui.editPage = true;
    ui.focusAfter = { id: 'pe-title', select: true };
    markDirty();
    location.hash = `#notes/${page.id}`;
  },
  'page-edit'() {
    ui.editPage = !ui.editPage;
    if (ui.editPage) ui.focusAfter = { id: 'pe-body' };
    renderView();
  },
  'page-del'(el) {
    const p = findPage(el.dataset.id);
    if (!p) return;
    const before = snapshot();
    state.pages = state.pages.filter((x) => x !== p);
    markDirty();
    location.hash = '#notes';
    toast(`Deleted “${p.title || 'Untitled'}”`, before);
  },
  'wiki-create'(el) {
    const page = addPage(el.dataset.title, 'General');
    ui.pageId = page.id;
    ui.editPage = true;
    ui.focusAfter = { id: 'pe-body' };
    markDirty();
    location.hash = `#notes/${page.id}`;
  },
  undo() {
    if (!undoSnapshot) return;
    state = normalize(JSON.parse(undoSnapshot));
    undoSnapshot = null;
    document.getElementById('toast').hidden = true;
    if (ui.view === 'notes' && ui.pageId && !findPage(ui.pageId)) ui.pageId = null;
    changed();
  },
  'settings-open'() {
    ui.settingsOpen = true;
    ui.disconnectArmed = false;
    renderSettings();
    document.getElementById('settings-x')?.focus();
  },
  'settings-close'() {
    ui.settingsOpen = false;
    renderSettings();
  },
  async reload() {
    ui.settingsOpen = false;
    renderSettings();
    if (sync.dirty) await saveNow();
    try {
      await loadData();
      sync.conflict = false;
      setStatus('saved');
      renderView();
      toast('Reloaded from GitHub');
    } catch (err) {
      toast(explain(err));
    }
  },
  backup() {
    downloadBackup();
  },
  async disconnect() {
    if (!ui.disconnectArmed) {
      ui.disconnectArmed = true;
      renderSettings();
      return;
    }
    if (sync.dirty && !sync.conflict && !sync.blocked) await saveNow();
    writeLocal(KEY.token, null);
    token = null;
    state = null;
    ui.settingsOpen = false;
    renderSettings();
    showConnect('Disconnected. Your data is still safe on GitHub.');
  },
  async 'conflict-keep'() {
    try {
      const latest = await readFile(cfg, token);
      sync.oldShas.add(sync.sha);
      sync.sha = latest.sha; // save on top of the newest version
      sync.conflict = false;
      sync.dirty = true;
      renderBanner();
      saveNow();
    } catch (err) {
      toast(explain(err));
    }
  },
  async 'conflict-load'() {
    try {
      await loadData();
      sync.conflict = false;
      sync.dirty = false;
      setStatus('saved');
      renderView();
      toast('Loaded the newest version');
    } catch (err) {
      toast(explain(err));
    }
  },
  retry() {
    sync.blocked = null;
    renderBanner();
    saveNow();
  },
};

// Checkboxes and dropdowns that do something special (fire on "change")
const CHANGE = {
  'step-check': stepCheck,
  'event-done'(el) {
    const e = findEvent(el.dataset.id);
    if (!e) return;
    const before = snapshot();
    e.done = el.checked;
    changed();
    if (el.checked) toast(`Checked off “${e.title || 'Untitled'}”`, before);
  },
  'md-task'(el) {
    const [kind, id] = el.dataset.src.split(/:(.+)/);
    const n = Number(el.dataset.n);
    if (kind === 'page') {
      const p = findPage(id);
      if (p) {
        p.body = toggleTask(p.body, n);
        p.updated = todayISO();
      }
    } else if (kind === 'ticket') {
      const found = findTicket(id);
      if (found) found.ticket.notes = toggleTask(found.ticket.notes, n);
    }
    changed();
  },
  'hide-done'(el) {
    ui.hideDone = el.checked;
    writeLocal(KEY.hideDone, el.checked ? '1' : '0');
    renderView();
  },
  'thought-move': thoughtMove,
};

// "Add" forms (Enter or the Add button)
const SUBMIT = {
  connect: connectSubmit,
  thought(form) {
    const text = field(form, 'text').value.trim();
    if (!text) return;
    state.inbox.unshift({ id: uid('h'), text, created: new Date().toISOString() });
    form.reset();
    changed();
  },
  ticket(form) {
    const title = field(form, 'title').value.trim();
    const section = findSection(form.dataset.section);
    if (!title || !section) return;
    addTicket(section, title);
    form.reset();
    changed();
  },
  step(form) {
    const text = field(form, 'text').value.trim();
    const found = findTicket(form.dataset.id);
    if (!text || !found) return;
    found.ticket.steps.push({ t: text, done: false });
    if (found.ticket.status === 'done') found.ticket.status = 'doing'; // new work reopens it
    form.reset();
    changed();
  },
  section(form) {
    const title = field(form, 'title').value.trim();
    if (!title) return;
    const id = newSectionId(title);
    state.sections.push({ id, title, blurb: '', later: false, items: [] });
    form.reset();
    ui.focusAfter = { id: `add-${id}` };
    ui.scrollTo = `sec-${id}`;
    changed();
  },
  event(form) {
    const title = field(form, 'title').value.trim();
    const date = form.dataset.date || field(form, 'date').value;
    if (!title || !isISODate(date)) return;
    state.events.push({ id: uid('e'), title, date, time: field(form, 'time').value, cat: field(form, 'cat').value, note: '', done: false });
    form.reset();
    changed();
    toast(`Added to ${formatShort(date)}`);
  },
  'thought-date'(form) {
    const thought = state.inbox.find((t) => t.id === form.dataset.id);
    const date = field(form, 'date').value;
    if (!thought || !isISODate(date)) return;
    const before = snapshot();
    const { title, extra } = splitThought(thought.text);
    state.events.push({ id: uid('e'), title, date, time: field(form, 'time').value, cat: field(form, 'cat').value, note: extra, done: false });
    state.inbox = state.inbox.filter((t) => t !== thought);
    ui.datingThought = null;
    changed();
    toast(`Added to ${formatShort(date)}`, before);
  },
  retoken(form) {
    token = field(form, 'token').value.trim();
    writeLocal(KEY.token, token);
    sync.blocked = null;
    renderBanner();
    sync.dirty = true;
    saveNow();
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.matches('input, select, textarea')) return; // fields are handled on "change"
  const handler = CLICK[el.dataset.act];
  if (handler) handler(el, e);
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.act && CHANGE[el.dataset.act]) {
    CHANGE[el.dataset.act](el, e);
  } else if (el.dataset.field && !isTextLike(el)) {
    // Dropdowns, dates and checkboxes: save and redraw
    setField(el);
    renderView();
  }
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.act === 'notes-search') {
    ui.notesQuery = el.value;
    renderView();
    return;
  }
  if (el.dataset.field && isTextLike(el)) setField(el); // typing: save quietly, no redraw
  if (el.tagName === 'TEXTAREA') autosize(el);
});

document.addEventListener('submit', (e) => {
  e.preventDefault(); // never actually submit a form; we handle it here
  const handler = SUBMIT[e.target.dataset.form];
  if (handler) handler(e.target);
});

document.addEventListener('keydown', (e) => {
  const el = e.target;
  if (e.key === 'Escape' && ui.settingsOpen) CLICK['settings-close']();
  // Brain dump: Enter adds, Shift+Enter makes a new line
  if (el.id === 'capture' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    el.form.requestSubmit();
  }
  // Ctrl/Cmd + Enter while writing a page = Done
  if (el.id === 'pe-body' && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    CLICK['page-edit']();
  }
});

// ===========================================================================
// 7. Start
// ===========================================================================

async function boot() {
  try {
    cfg = JSON.parse(readLocal(KEY.config) || 'null');
  } catch {
    cfg = null;
  }
  token = readLocal(KEY.token);
  if (!cfg || !token) {
    showConnect();
    return;
  }
  root.innerHTML = '<p class="boot">Loading your tracker…</p>';
  try {
    await loadData();
    showApp();
  } catch (err) {
    showConnect(explain(err), true);
  }
}

boot();

// notes.js — the Notes screen: pages grouped in folders, like a small Notion.
// Left: search + list of pages. Right: the open page (read it, or Edit to write).
import { esc, allTickets } from './ui.js';
import { formatMonthDay } from '../dates.js';

export function renderNotes(ctx) {
  const page = ctx.state.pages.find((p) => p.id === ctx.ui.pageId) || null;
  return `
    <div class="notes-layout${page ? ' has-page' : ''}">
      ${sidebar(ctx, page)}
      <article class="page-pane">${page ? pageView(page, ctx) : emptyPane()}</article>
    </div>`;
}

function sidebar(ctx, current) {
  const query = ctx.ui.notesQuery.trim().toLowerCase();
  const matches = ctx.state.pages.filter(
    (p) => !query || [p.title, p.body, p.folder].some((text) => text.toLowerCase().includes(query))
  );

  // Group by folder, folders A–Z, newest page first inside each folder
  const folders = {};
  matches.forEach((p) => (folders[p.folder] ||= []).push(p));
  const groups = Object.keys(folders)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const pages = folders[name].sort((a, b) => b.updated.localeCompare(a.updated) || a.title.localeCompare(b.title));
      const links = pages
        .map((p) => {
          const active = current && current.id === p.id;
          return `<li><a class="page-link${active ? ' is-active' : ''}" href="#notes/${esc(p.id)}"${active ? ' aria-current="page"' : ''}><span data-sync="page:${esc(p.id)}:title">${esc(p.title) || 'Untitled'}</span><time>${formatMonthDay(p.updated)}</time></a></li>`;
        })
        .join('');
      return `<div class="folder"><h2 class="folder-h">${esc(name)} <span>${pages.length}</span></h2><ul>${links}</ul></div>`;
    })
    .join('');

  return `
    <aside class="notes-side">
      <div class="notes-side-head"><h1>Notes</h1><button type="button" class="primary-btn small" data-act="page-new">New page</button></div>
      <label class="sr" for="notes-search">Search notes</label>
      <input type="search" id="notes-search" class="search" data-act="notes-search" placeholder="Search notes" value="${esc(ctx.ui.notesQuery)}" autocomplete="off">
      ${groups || `<p class="empty">${query ? 'No notes match that search.' : 'No notes yet. Click New page.'}</p>`}
    </aside>`;
}

function pageView(p, ctx) {
  const editing = ctx.ui.editPage;
  const top = `
    <div class="page-top">
      <a class="back" href="#notes">← All notes</a>
      <button type="button" class="${editing ? 'primary-btn' : 'ghost-btn'} small" data-act="page-edit">${editing ? 'Done' : 'Edit'}</button>
    </div>`;

  if (editing) {
    const folderNames = [...new Set(ctx.state.pages.map((x) => x.folder))].sort();
    return `${top}
      <div class="page-edit">
        <label class="field"><span>Title</span><input id="pe-title" class="title-input" data-kind="page" data-id="${esc(p.id)}" data-field="title" value="${esc(p.title)}"></label>
        <label class="field"><span>Folder</span><input id="pe-folder" list="folder-list" data-kind="page" data-id="${esc(p.id)}" data-field="folder" value="${esc(p.folder)}" autocomplete="off"></label>
        <datalist id="folder-list">${folderNames.map((f) => `<option value="${esc(f)}">`).join('')}</datalist>
        <label class="field"><span>Page</span><textarea id="pe-body" class="md-input tall" data-kind="page" data-id="${esc(p.id)}" data-field="body" rows="18" placeholder="Start writing…">${esc(p.body)}</textarea></label>
        <p class="hint"><code>**bold**</code> <code>*italic*</code> <code># Heading</code> <code>- list</code> <code>- [ ] checkbox</code> <code>\`code\`</code> <code>[[Page title]]</code> links another note. Ctrl/⌘ + Enter = Done.</p>
        <div class="row-actions"><button type="button" class="danger-btn small" data-act="page-del" data-id="${esc(p.id)}">Delete page</button></div>
      </div>`;
  }

  return `${top}
    <p class="eyebrow">${esc(p.folder)} · Updated ${formatMonthDay(p.updated)}</p>
    <h1 class="page-title">${esc(p.title) || 'Untitled'}</h1>
    ${p.body.trim() ? `<div class="md">${ctx.md(p.body, `page:${p.id}`)}</div>` : '<p class="empty">This page is empty. Click Edit to write.</p>'}
    ${backlinks(p, ctx)}`;
}

// "Linked from": every page or ticket that mentions [[this page]]
function backlinks(p, ctx) {
  const title = p.title.trim().toLowerCase();
  if (!title) return '';
  const mentions = (text) => {
    const t = text.toLowerCase();
    return t.includes(`[[${title}]]`) || t.includes(`[[${title}|`);
  };
  const pages = ctx.state.pages.filter((x) => x.id !== p.id && mentions(x.body));
  const tickets = allTickets(ctx.state).filter(({ ticket }) => mentions(ticket.notes));
  if (!pages.length && !tickets.length) return '';
  const items = [
    ...tickets.map(({ ticket: t }) => `<li><a href="#board/${esc(t.id)}"><span class="tk-badge">${esc(t.id)}</span> ${esc(t.title)}</a></li>`),
    ...pages.map((x) => `<li><a href="#notes/${esc(x.id)}">${esc(x.title)}</a></li>`),
  ].join('');
  return `<div class="backlinks"><h2 class="group-h">Linked from</h2><ul>${items}</ul></div>`;
}

function emptyPane() {
  return `
    <div class="empty-pane">
      <h2>Pick a page, or start a new one.</h2>
      <p>Notes are for anything longer than a thought: lesson notes, interview answers, plans, things to remember.</p>
    </div>`;
}

// board.js — the Board screen: sections of tickets.
// Click a status to move a ticket along. Click a title to open it and edit
// everything: title, summary, status, due date, section, steps, and notes.
import { esc, statusButton, dueChip, ICONS } from './ui.js';
import { STATUS } from './constants.js';

export function renderBoard(ctx) {
  const { state, ui } = ctx;
  const all = state.sections.flatMap((s) => s.items);
  const count = (status) => all.filter((t) => t.status === status).length;
  return `
    <div class="page-head">
      <div>
        <p class="eyebrow">${count('doing')} in progress · ${count('todo')} to do · ${count('done')} done</p>
        <h1>Board</h1>
      </div>
      <label class="toggle"><input type="checkbox" id="hide-done" data-act="hide-done"${ui.hideDone ? ' checked' : ''}> Hide done</label>
    </div>
    <div class="board${ui.hideDone ? ' hide-done' : ''}">
      ${state.sections.map((s, i) => section(s, i, ctx)).join('')}
      <form class="add add-section" data-form="section">
        <label class="sr" for="new-section">New section name</label>
        <input id="new-section" name="title" placeholder="New section, e.g. Apartment hunt" autocomplete="off">
        <button type="submit">Add section</button>
      </form>
    </div>`;
}

function section(s, index, ctx) {
  const id = esc(s.id);
  const done = s.items.filter((t) => t.status === 'done').length;
  const open = s.items.filter((t) => t.status !== 'closed').length;
  const editing = ctx.ui.editSection === s.id;
  const last = index === ctx.state.sections.length - 1;
  let h = `
    <section class="area${s.later ? ' is-later' : ''}" id="sec-${id}" aria-labelledby="h-${id}">
      <div class="area-head">
        <span class="prefix">${id}</span>
        <h2 id="h-${id}" data-sync="section:${id}:title">${esc(s.title)}</h2>
        ${s.later ? '<span class="later">Later</span>' : ''}
        <span class="tally">${done}/${open} done</span>
        <button type="button" class="ghost-btn small" data-act="section-edit" data-id="${id}" aria-expanded="${editing}">${editing ? 'Done' : 'Edit'}</button>
      </div>`;
  if (editing) {
    h += `
      <div class="section-edit">
        <label class="field"><span>Name</span><input id="se-title-${id}" data-kind="section" data-id="${id}" data-field="title" value="${esc(s.title)}"></label>
        <label class="field"><span>Description</span><input id="se-blurb-${id}" data-kind="section" data-id="${id}" data-field="blurb" value="${esc(s.blurb)}" placeholder="Optional"></label>
        <label class="check"><input type="checkbox" id="se-later-${id}" data-kind="section" data-id="${id}" data-field="later"${s.later ? ' checked' : ''}> Mark as “Later” (dims it so it doesn’t compete with today’s work)</label>
        <div class="row-actions">
          <button type="button" class="ghost-btn small" data-act="section-move" data-dir="-1" data-id="${id}"${index === 0 ? ' disabled' : ''}>Move up</button>
          <button type="button" class="ghost-btn small" data-act="section-move" data-dir="1" data-id="${id}"${last ? ' disabled' : ''}>Move down</button>
          <button type="button" class="danger-btn small" data-act="section-del" data-id="${id}">Delete section</button>
        </div>
      </div>`;
  }
  if (s.blurb) h += `<p class="blurb" data-sync="section:${id}:blurb">${esc(s.blurb)}</p>`;
  h += s.items.length
    ? `<ul class="items">${s.items.map((t) => ticket(t, ctx)).join('')}</ul>`
    : '<p class="empty in-area">No tickets here yet.</p>';
  h += `
      <form class="add" data-form="ticket" data-section="${id}">
        <label class="sr" for="add-${id}">Add a ticket to ${esc(s.title)}</label>
        <input id="add-${id}" name="title" placeholder="Add a ticket" autocomplete="off">
        <button type="submit">Add</button>
      </form>
    </section>`;
  return h;
}

function ticket(t, ctx) {
  const id = esc(t.id);
  const open = ctx.ui.openTickets.has(t.id);
  const stepsDone = t.steps.filter((x) => x.done).length;
  let h = `
    <li class="item st-${t.status}${open ? ' is-open' : ''}" id="t-${id}">
      <div class="item-row">
        ${statusButton(t)}
        <div class="body">
          <div class="line">
            <span class="key">${id}</span>
            <button type="button" class="title-btn" data-act="ticket-toggle" data-id="${id}" aria-expanded="${open}" data-sync="ticket:${id}:title">${esc(t.title) || 'Untitled'}</button>
            ${dueChip(t.due, ctx.today, t.status)}
            ${t.steps.length ? `<span class="stepcount">${stepsDone}/${t.steps.length}</span>` : ''}
            ${t.notes.trim() && !open ? '<span class="has-notes">Notes</span>' : ''}
          </div>
          ${t.note && !open ? `<p class="note">${esc(t.note)}</p>` : ''}
          ${t.steps.length && !open ? stepChecklist(t) : ''}
        </div>
        <button type="button" class="chev" data-act="ticket-toggle" data-id="${id}" aria-expanded="${open}" aria-label="${open ? 'Close' : 'Open'} ${id}">${ICONS.chevron}</button>
      </div>`;
  if (open) h += detail(t, ctx);
  return `${h}</li>`;
}

// Read-only list of steps with checkboxes, shown while the ticket is closed
function stepChecklist(t) {
  const id = esc(t.id);
  return `<ul class="steps">${t.steps
    .map(
      (x, k) =>
        `<li><input type="checkbox" id="${id}-s${k}" data-act="step-check" data-id="${id}" data-k="${k}"${x.done ? ' checked' : ''}><label for="${id}-s${k}">${esc(x.t)}</label></li>`
    )
    .join('')}</ul>`;
}

// Everything you can edit once a ticket is open
function detail(t, ctx) {
  const id = esc(t.id);
  const sectionOptions = ctx.state.sections
    .map((s) => `<option value="${esc(s.id)}"${s.items.includes(t) ? ' selected' : ''}>${esc(s.title)}</option>`)
    .join('');
  const statusOptions = Object.entries(STATUS)
    .map(([key, label]) => `<option value="${key}"${key === t.status ? ' selected' : ''}>${label}</option>`)
    .join('');
  const editingNotes = ctx.ui.editTicketNotes.has(t.id);

  const steps = t.steps
    .map(
      (x, k) => `
        <li>
          <input type="checkbox" id="${id}-s${k}" data-act="step-check" data-id="${id}" data-k="${k}"${x.done ? ' checked' : ''} aria-label="Step ${k + 1} done">
          <input class="step-text" id="${id}-st${k}" data-kind="step" data-id="${id}" data-k="${k}" data-field="t" value="${esc(x.t)}" aria-label="Step ${k + 1}">
          <button type="button" class="x-btn" data-act="step-del" data-id="${id}" data-k="${k}" aria-label="Remove step ${k + 1}">×</button>
        </li>`
    )
    .join('');

  const notes = editingNotes
    ? `<textarea id="tnotes-${id}" class="md-input" data-kind="ticket" data-id="${id}" data-field="notes" rows="6" placeholder="Anything about this ticket. **bold**, - lists, - [ ] checkboxes, [[Page title]] links a note.">${esc(t.notes)}</textarea>`
    : t.notes.trim()
      ? `<div class="md">${ctx.md(t.notes, `ticket:${t.id}`)}</div>`
      : '<p class="empty">No notes yet.</p>';

  return `
    <div class="detail">
      <div class="field-grid">
        <label class="field wide"><span>Title</span><input id="tt-${id}" data-kind="ticket" data-id="${id}" data-field="title" value="${esc(t.title)}"></label>
        <label class="field wide"><span>One-line summary</span><input id="tn-${id}" data-kind="ticket" data-id="${id}" data-field="note" value="${esc(t.note)}" placeholder="Shows under the title"></label>
        <label class="field"><span>Status</span><select id="ts-${id}" data-kind="ticket" data-id="${id}" data-field="status">${statusOptions}</select></label>
        <div class="field">
          <label for="tdue-${id}">Due date</label>
          <div class="inline">
            <input type="date" id="tdue-${id}" data-kind="ticket" data-id="${id}" data-field="due" value="${esc(t.due)}">
            ${t.due ? `<button type="button" class="ghost-btn small" data-act="ticket-due-clear" data-id="${id}">Clear</button>` : ''}
          </div>
        </div>
        <label class="field"><span>Section</span><select id="tsec-${id}" data-kind="ticket" data-id="${id}" data-field="section">${sectionOptions}</select></label>
      </div>

      <div class="sub">
        <h3 class="sub-h">Steps</h3>
        ${t.steps.length ? `<ul class="steps-edit">${steps}</ul>` : ''}
        <form class="add add-step" data-form="step" data-id="${id}">
          <label class="sr" for="ns-${id}">Add a step</label>
          <input id="ns-${id}" name="text" placeholder="Add a step" autocomplete="off">
          <button type="submit">Add</button>
        </form>
      </div>

      <div class="sub">
        <div class="sub-head">
          <h3 class="sub-h">Notes</h3>
          <button type="button" class="ghost-btn small" data-act="ticket-notes-edit" data-id="${id}">${editingNotes ? 'Done' : t.notes.trim() ? 'Edit' : 'Write'}</button>
        </div>
        ${notes}
      </div>

      <div class="detail-foot">
        <button type="button" class="danger-btn small" data-act="ticket-del" data-id="${id}">Delete ticket</button>
      </div>
    </div>`;
}

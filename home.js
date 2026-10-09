// home.js — the Home screen: brain dump, what's coming up, what's in progress.
import { esc, catOptions, datedThings, allTickets } from './ui.js';
import { CATS, STATUS } from '../constants.js';
import { daysBetween, formatLong, formatShort, formatTime, formatStamp, relative } from '../dates.js';

// Groups for "Coming up". n = how many days from today. First match wins.
const GROUPS = [
  { label: 'Overdue', test: (n) => n < 0, cls: 'is-late' },
  { label: 'Today', test: (n) => n === 0, cls: 'is-now' },
  { label: 'Tomorrow', test: (n) => n === 1 },
  { label: 'This week', test: (n) => n >= 2 && n <= 7 },
  { label: 'Next 30 days', test: (n) => n >= 8 && n <= 30 },
  { label: 'Later', test: (n) => n > 30 },
];

export function renderHome(ctx) {
  return `
    <div class="page-head"><div><p class="eyebrow">${esc(formatLong(ctx.today))}</p><h1>What's next</h1></div></div>
    ${captureBox()}
    <div class="home-grid">
      <div class="col">${comingUp(ctx)}${inProgress(ctx.state)}</div>
      <div class="col">${thoughts(ctx)}</div>
    </div>`;
}

// The brain-dump box. Enter adds the thought; Shift+Enter makes a new line.
function captureBox() {
  return `
    <form class="capture" data-form="thought">
      <label class="sr" for="capture">Brain dump</label>
      <textarea id="capture" name="text" rows="1" placeholder="Dump a thought and press Enter. Sort it out later."></textarea>
      <button type="submit" class="primary-btn">Add</button>
    </form>`;
}

function comingUp(ctx) {
  const { state, today } = ctx;
  const open = datedThings(state).filter((x) => !x.done);
  let body = '';
  for (const group of GROUPS) {
    const list = open.filter((x) => group.test(daysBetween(today, x.date)));
    if (!list.length) continue;
    body += `
      <div class="due-group ${group.cls || ''}">
        <h3 class="group-h">${group.label} <span>${list.length}</span></h3>
        <ul class="due-list">${list.map((x) => dueRow(x, today)).join('')}</ul>
      </div>`;
  }
  if (!body) body = '<p class="empty">Nothing with a date yet. Add one below, or give a ticket a due date.</p>';
  return `
    <section class="panel" aria-labelledby="up-h">
      <div class="panel-head"><h2 id="up-h">Coming up</h2><a class="panel-link" href="#calendar">Calendar</a></div>
      ${body}
      ${addDateForm(today)}
    </section>`;
}

function dueRow(x, today) {
  const n = daysBetween(today, x.date);
  const when = `<span class="due-when${n < 0 ? ' is-late' : n === 0 ? ' is-now' : ''}">${relative(x.date, today)}</span>`;
  const time = x.time ? ` · ${formatTime(x.time)}` : '';
  if (x.kind === 'event') {
    return `
      <li class="due-row cat-${x.cat}">
        <input type="checkbox" class="cat-check" id="hd-${esc(x.id)}" data-act="event-done" data-id="${esc(x.id)}" aria-label="Check off ${esc(x.title)}">
        <div class="due-main">
          <a class="due-title" href="#calendar/${x.date}">${esc(x.title)}</a>
          <span class="due-meta"><span class="cat-dot"></span>${CATS[x.cat]} · ${formatShort(x.date)}${time}</span>
        </div>
        ${when}
      </li>`;
  }
  return `
    <li class="due-row is-ticket">
      <span class="tk-badge">${esc(x.id)}</span>
      <div class="due-main">
        <a class="due-title" href="#board/${esc(x.id)}">${esc(x.title)}</a>
        <span class="due-meta">Ticket due ${formatShort(x.date)} · ${STATUS[x.status]}</span>
      </div>
      ${when}
    </li>`;
}

function addDateForm(today) {
  return `
    <form class="date-form" data-form="event">
      <label class="sr" for="ne-title">What's happening</label>
      <input id="ne-title" name="title" class="grow" placeholder="Add a date: interview, deadline, exam…" required autocomplete="off">
      <label class="sr" for="ne-date">Date</label>
      <input id="ne-date" name="date" type="date" value="${today}" required>
      <label class="sr" for="ne-time">Time (optional)</label>
      <input id="ne-time" name="time" type="time">
      <label class="sr" for="ne-cat">Category</label>
      <select id="ne-cat" name="cat">${catOptions('job')}</select>
      <button type="submit">Add date</button>
    </form>`;
}

function inProgress(state) {
  const doing = allTickets(state).filter(({ ticket }) => ticket.status === 'doing');
  const rows = doing
    .map(({ ticket: t }) => {
      const next = t.steps.find((s) => !s.done);
      return `
        <li>
          <a class="key" href="#board/${esc(t.id)}">${esc(t.id)}</a>
          <div class="ip-main">
            <a class="ip-title" href="#board/${esc(t.id)}">${esc(t.title) || 'Untitled'}</a>
            ${next ? `<span class="ip-next">Next: ${esc(next.t)}</span>` : ''}
          </div>
        </li>`;
    })
    .join('');
  return `
    <section class="panel" aria-labelledby="ip-h">
      <div class="panel-head"><h2 id="ip-h">In progress</h2><a class="panel-link" href="#board">Board</a></div>
      ${doing.length ? `<ul class="ip-list">${rows}</ul>` : '<p class="empty">Nothing in progress. Click a ticket’s status on the Board to start it.</p>'}
    </section>`;
}

function thoughts(ctx) {
  const { state, ui, today } = ctx;
  const sectionOptions = state.sections
    .map((s) => `<option value="ticket:${esc(s.id)}">${esc(s.title)}</option>`)
    .join('');
  const rows = state.inbox
    .map((t) => {
      const id = esc(t.id);
      let row = `
        <li class="thought">
          <p class="thought-text">${esc(t.text)}</p>
          <div class="thought-meta">
            <time>${formatStamp(t.created)}</time>
            <label class="sr" for="tm-${id}">Turn this thought into</label>
            <select id="tm-${id}" class="mini" data-act="thought-move" data-id="${id}">
              <option value="">Turn into…</option>
              <optgroup label="A ticket in">${sectionOptions}</optgroup>
              <option value="note">A note page</option>
              <option value="date">A date…</option>
            </select>
            <button type="button" class="ghost-btn small" data-act="thought-del" data-id="${id}">Clear</button>
          </div>`;
      // "A date…" picked: ask which day, right here in the row
      if (ui.datingThought === t.id) {
        row += `
          <form class="date-form compact" data-form="thought-date" data-id="${id}">
            <label class="sr" for="thd-${id}">Date</label>
            <input type="date" id="thd-${id}" name="date" value="${today}" required>
            <label class="sr" for="tht-${id}">Time (optional)</label>
            <input type="time" id="tht-${id}" name="time">
            <label class="sr" for="thc-${id}">Category</label>
            <select id="thc-${id}" name="cat">${catOptions('life')}</select>
            <button type="submit">Add date</button>
            <button type="button" class="ghost-btn" data-act="thought-date-cancel">Cancel</button>
          </form>`;
      }
      return `${row}</li>`;
    })
    .join('');
  return `
    <section class="panel" aria-labelledby="th-h">
      <div class="panel-head"><h2 id="th-h">Thoughts</h2>${state.inbox.length ? `<span class="count">${state.inbox.length}</span>` : ''}</div>
      ${state.inbox.length ? `<ul class="thought-list">${rows}</ul>` : '<p class="empty">Empty. Anything on your mind goes in the box above. Later, turn each one into a ticket, a note, or a date, or clear it.</p>'}
    </section>`;
}

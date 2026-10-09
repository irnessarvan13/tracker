// calendar.js — the Calendar screen: a month grid plus the selected day's list.
// Solid chips are dates you added; dashed chips are tickets with a due date.
import { esc, catOptions, datedThings } from './ui.js';
import { CATS, STATUS } from '../constants.js';
import { formatLong, formatTime, monthGrid, monthTitle, relative } from '../dates.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function renderCalendar(ctx) {
  const { state, ui, today } = ctx;

  // Group everything by day, e.g. { "2026-10-10": [ … ] }
  const byDay = {};
  datedThings(state).forEach((x) => (byDay[x.date] ||= []).push(x));

  const cells = monthGrid(ui.calY, ui.calM)
    .map((iso) => {
      const list = byDay[iso] || [];
      const outside = Number(iso.slice(5, 7)) - 1 !== ui.calM; // belongs to the previous/next month
      const classes = ['day', outside && 'is-out', iso === today && 'is-today', iso === ui.day && 'is-selected']
        .filter(Boolean)
        .join(' ');
      const chips = list
        .slice(0, 3)
        .map((x) => `<span class="chip ${x.kind === 'ticket' ? 'chip-ticket' : `cat-${x.cat}`}${x.done ? ' is-done' : ''}">${esc(x.title)}</span>`)
        .join('');
      const more = list.length > 3 ? `<span class="more">+${list.length - 3} more</span>` : '';
      const label = `${formatLong(iso)}${list.length ? `, ${list.length} item${list.length > 1 ? 's' : ''}` : ''}`;
      return `<button type="button" class="${classes}" id="day-${iso}" data-act="cal-day" data-date="${iso}" aria-label="${esc(label)}" aria-pressed="${iso === ui.day}"><span class="dnum">${Number(iso.slice(8))}</span><span class="chips">${chips}${more}</span></button>`;
    })
    .join('');

  return `
    <div class="page-head">
      <div><p class="eyebrow">Calendar</p><h1>${monthTitle(ui.calY, ui.calM)}</h1></div>
      <div class="cal-nav">
        <button type="button" class="nav-btn" data-act="cal-move" data-dir="-1" aria-label="Previous month">‹</button>
        <button type="button" class="nav-btn" data-act="cal-today">Today</button>
        <button type="button" class="nav-btn" data-act="cal-move" data-dir="1" aria-label="Next month">›</button>
      </div>
    </div>
    <div class="cal-layout">
      <div class="cal-main">
        <div class="cal-dow" aria-hidden="true">${WEEKDAYS.map((d) => `<span>${d}</span>`).join('')}</div>
        <div class="cal-grid">${cells}</div>
      </div>
      ${dayPanel(ctx, byDay[ui.day] || [])}
    </div>`;
}

// The list for the day you clicked, with an "add" form for that day
function dayPanel(ctx, list) {
  const { ui, today } = ctx;
  const rows = list.map((x) => (x.kind === 'event' ? eventRow(x.ref, ctx) : ticketRow(x))).join('');
  return `
    <aside class="panel day-panel" aria-labelledby="day-h">
      <p class="eyebrow">${relative(ui.day, today)}</p>
      <h2 id="day-h">${formatLong(ui.day)}</h2>
      ${list.length ? `<ul class="day-list">${rows}</ul>` : '<p class="empty">Nothing on this day.</p>'}
      <form class="date-form stacked" data-form="event" data-date="${ui.day}">
        <label class="sr" for="de-title">Add something on this day</label>
        <input id="de-title" name="title" placeholder="Add something on this day" required autocomplete="off">
        <div class="inline">
          <label class="sr" for="de-time">Time (optional)</label>
          <input type="time" id="de-time" name="time">
          <label class="sr" for="de-cat">Category</label>
          <select id="de-cat" name="cat">${catOptions('job')}</select>
          <button type="submit">Add</button>
        </div>
      </form>
    </aside>`;
}

function eventRow(e, ctx) {
  const id = esc(e.id);
  const editing = ctx.ui.editEvent === e.id;
  let h = `
    <li class="ev-row cat-${e.cat}${e.done ? ' is-done' : ''}">
      <div class="ev-line">
        <input type="checkbox" class="cat-check" id="evd-${id}" data-act="event-done" data-id="${id}"${e.done ? ' checked' : ''} aria-label="Check off ${esc(e.title)}">
        <div class="ev-main">
          <span class="ev-title" data-sync="event:${id}:title">${esc(e.title) || 'Untitled'}</span>
          <span class="ev-meta"><span class="cat-dot"></span>${e.time ? `${formatTime(e.time)} · ` : ''}${CATS[e.cat]}</span>
        </div>
        <button type="button" class="ghost-btn small" data-act="event-edit" data-id="${id}" aria-expanded="${editing}">${editing ? 'Done' : 'Edit'}</button>
      </div>`;
  if (e.note && !editing) h += `<p class="ev-note">${esc(e.note)}</p>`;
  if (editing) {
    h += `
      <div class="ev-edit field-grid">
        <label class="field wide"><span>Title</span><input id="ee-title-${id}" data-kind="event" data-id="${id}" data-field="title" value="${esc(e.title)}"></label>
        <label class="field"><span>Date</span><input type="date" id="ee-date-${id}" data-kind="event" data-id="${id}" data-field="date" value="${e.date}" required></label>
        <label class="field"><span>Time</span><input type="time" id="ee-time-${id}" data-kind="event" data-id="${id}" data-field="time" value="${e.time}"></label>
        <label class="field"><span>Category</span><select id="ee-cat-${id}" data-kind="event" data-id="${id}" data-field="cat">${catOptions(e.cat)}</select></label>
        <label class="field wide"><span>Note</span><textarea id="ee-note-${id}" data-kind="event" data-id="${id}" data-field="note" rows="2">${esc(e.note)}</textarea></label>
        <div class="wide row-actions"><button type="button" class="danger-btn small" data-act="event-del" data-id="${id}">Delete</button></div>
      </div>`;
  }
  return `${h}</li>`;
}

function ticketRow(x) {
  return `
    <li class="ev-row is-ticket${x.done ? ' is-done' : ''}">
      <div class="ev-line">
        <span class="tk-badge">${esc(x.id)}</span>
        <div class="ev-main">
          <a class="ev-title" href="#board/${esc(x.id)}">${esc(x.title)}</a>
          <span class="ev-meta">Ticket due · ${STATUS[x.status]}</span>
        </div>
      </div>
    </li>`;
}

// ui.js — small building blocks every screen shares.
import { STATUS, CATS } from './constants.js';
import { daysBetween, formatMonthDay, relative } from './dates.js';
export { escapeHTML as esc } from './markdown.js';
import { escapeHTML as esc } from './markdown.js';

// The colored status pill on a ticket. Clicking it moves the ticket along.
export function statusButton(t) {
  return `<button type="button" class="status s-${t.status}" id="st-${esc(t.id)}" data-act="cycle" data-id="${esc(t.id)}" aria-label="${esc(t.id)} is ${STATUS[t.status]}. Click to change."><span class="sdot"></span>${STATUS[t.status]}</button>`;
}

// <option>s for the category dropdowns
export function catOptions(selected) {
  return Object.entries(CATS)
    .map(([key, label]) => `<option value="${key}"${key === selected ? ' selected' : ''}>${label}</option>`)
    .join('');
}

// "Due Oct 20" chip on a ticket. Red when late, amber when it's 3 days away or less.
export function dueChip(due, today, status) {
  if (!due) return '';
  const n = daysBetween(today, due);
  const finished = status === 'done' || status === 'closed';
  const tone = finished ? '' : n < 0 ? ' is-late' : n <= 3 ? ' is-soon' : '';
  return `<span class="due-chip${tone}" title="Due ${relative(due, today)}">Due ${formatMonthDay(due)}</span>`;
}

// Every ticket with the section it lives in
export function allTickets(state) {
  const out = [];
  state.sections.forEach((section) => section.items.forEach((ticket) => out.push({ section, ticket })));
  return out;
}

// Everything that has a date: standalone dates plus tickets with a due date,
// sorted by day and then by time (things without a time go last in their day).
export function datedThings(state) {
  const list = [];
  state.events.forEach((e) =>
    list.push({ kind: 'event', id: e.id, title: e.title || 'Untitled', date: e.date, time: e.time, cat: e.cat, done: e.done, ref: e })
  );
  allTickets(state).forEach(({ ticket: t }) => {
    if (!t.due) return;
    list.push({
      kind: 'ticket', id: t.id, title: t.title || 'Untitled', date: t.due, time: '', cat: null,
      done: t.status === 'done' || t.status === 'closed', status: t.status, ref: t,
    });
  });
  return list.sort((a, b) => a.date.localeCompare(b.date) || (a.time || '99').localeCompare(b.time || '99'));
}

// Simple line icons. They use currentColor, so they match the text color in both themes.
const svg = (path) =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

export const ICONS = {
  home: svg('<path d="M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1H15v-6H9v6H4.5a1 1 0 0 1-1-1z"/>'),
  board: svg('<rect x="3.5" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="16.5" y="4" width="4" height="7" rx="1.5"/>'),
  calendar: svg('<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  notes: svg('<path d="M6 3.5h8.5l4 4V20.5H6z"/><path d="M14 3.5V8h4.5M9 12.5h6.5M9 16h4.5"/>'),
  settings: svg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
  chevron: svg('<path d="m9 6 6 6-6 6"/>'),
};

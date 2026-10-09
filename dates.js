// dates.js — small helpers for calendar dates.
//
// Every date in the tracker is saved as a plain "YYYY-MM-DD" string.
// Why a string and not a Date object? A Date is a moment in time in a specific
// time zone, so "Oct 10" can quietly turn into "Oct 9" when it gets converted.
// "2026-10-10" is just a day on the calendar, with no time zone to go wrong.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// 7 -> "07"
function pad(n) {
  return String(n).padStart(2, '0');
}

// Date object -> "YYYY-MM-DD", using YOUR local calendar day (not UTC).
export function toISO(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayISO() {
  return toISO(new Date());
}

// "YYYY-MM-DD" -> Date at local midnight
export function fromISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Is this a real "YYYY-MM-DD" string? (Used to check data before trusting it.)
export function isISODate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// Whole days from a to b. Positive = b is later.
// Math.round soaks up the extra/missing hour on daylight-saving days.
export function daysBetween(a, b) {
  return Math.round((fromISO(b) - fromISO(a)) / 86400000);
}

export function addDays(iso, n) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

// "Sat, Oct 10"
export function formatShort(iso) {
  const d = fromISO(iso);
  return `${DAYS[d.getDay()].slice(0, 3)}, ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
}

// "Saturday, October 10"
export function formatLong(iso) {
  const d = fromISO(iso);
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

// "Oct 10", or "Oct 10, 2027" when it isn't this year
export function formatMonthDay(iso) {
  const d = fromISO(iso);
  const base = `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
  return d.getFullYear() === new Date().getFullYear() ? base : `${base}, ${d.getFullYear()}`;
}

// "October 2026"
export function monthTitle(year, month) {
  return `${MONTHS[month]} ${year}`;
}

// "today", "tomorrow", "in 12 days", "3 days ago"
export function relative(iso, today = todayISO()) {
  const n = daysBetween(today, iso);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 1 ? `in ${n} days` : `${-n} days ago`;
}

// "14:30" -> "2:30 PM"
export function formatTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`;
}

// A saved timestamp -> "Oct 8, 4:56 PM"
export function formatStamp(timestamp) {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}, ${formatTime(`${d.getHours()}:${pad(d.getMinutes())}`)}`;
}

// The 42 days (6 rows of 7) the month grid shows, starting on a Sunday.
export function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const days = [];
  for (let i = 0; i < 42; i++) {
    // Day 1 minus the weekday of the 1st = the Sunday on or before it
    days.push(toISO(new Date(year, month, 1 - first.getDay() + i)));
  }
  return days;
}

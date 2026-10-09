// constants.js — fixed lists that every part of the app shares.

// Ticket statuses. The keys (todo, doing…) are what gets saved in data.json;
// the values are the words you see on screen.
export const STATUS = {
  todo: 'To do',
  doing: 'In progress',
  done: 'Done',
  closed: 'Closed',
};

// What one click on a status button changes it to.
// "Closed" (gave up / no longer relevant) is only set from the ticket's Status dropdown.
export const NEXT_STATUS = { todo: 'doing', doing: 'done', done: 'todo', closed: 'todo' };

// Categories for dates. Each one has its own color in styles.css (.cat-job, .cat-school, …).
export const CATS = {
  job: 'Job',
  school: 'School',
  german: 'German',
  project: 'Projects',
  life: 'Life',
};

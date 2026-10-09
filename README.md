# Tracker

My personal tracker: a brain-dump inbox, tickets, a calendar of upcoming dates, and notes, all in one page.

This repo is public, but **it holds no data**, only the page. Everything I write lives in a separate **private** repo (`tracker-data/data.json`). The page reads and saves that file through the GitHub API using a fine-grained token that only has access to that one repo. Without the token, the page shows a connect screen and nothing else.

## How it works

```
Browser (GitHub Pages)  ──  token  ──>  api.github.com  ──>  private repo: tracker-data/data.json
```

1. The token lives in this browser's localStorage and is only ever sent to `api.github.com`.
2. On load, the page downloads `data.json` (GET /repos/{owner}/{repo}/contents/data.json).
3. Every change is saved back with a PUT, which makes a commit, so the file's commit history is a full undo log.
4. Each save sends the version's `sha`. If the file changed on another device, GitHub answers 409 and the page asks which version to keep instead of overwriting.
5. A Content-Security-Policy only allows the page's own scripts and only allows requests to `api.github.com`.

## Files

| File | Job |
| --- | --- |
| `index.html` | Page shell and security policy |
| `styles.css` | All styling, light and dark |
| `js/app.js` | State, saving, routing, and every button's behavior |
| `js/github.js` | The only code that talks to GitHub |
| `js/markdown.js` | Turns note text into HTML (escaped first, so notes can't run code) |
| `js/dates.js` | Date helpers |
| `js/views/*.js` | One file per screen: Home, Board, Calendar, Notes |

No build step and no dependencies: plain HTML, CSS, and JavaScript modules.

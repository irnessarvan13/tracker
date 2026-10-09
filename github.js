// github.js — the ONLY file that talks to GitHub.
//
// Your data is one JSON file in a private repo. GitHub's "contents" API lets us:
//   GET  /repos/{owner}/{repo}/contents/{path}  -> the file (as base64) + its sha
//   PUT  /repos/{owner}/{repo}/contents/{path}  -> save new text (this makes a commit)
//
// What's a sha? A fingerprint GitHub gives each version of a file. When we save,
// we send the sha of the version we started from. If the file changed somewhere
// else in the meantime (your phone, another tab), the shas won't match and GitHub
// answers 409 Conflict instead of silently overwriting the newer version.

const API = 'https://api.github.com';

// An error that remembers the HTTP status code (401, 404, 409…). 0 means "no network".
export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function repoUrl(cfg) {
  return `${API}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
}

function contentsUrl(cfg) {
  // Encode each folder name separately so the slashes between them survive
  const path = cfg.path.split('/').map(encodeURIComponent).join('/');
  return `${repoUrl(cfg)}/contents/${path}`;
}

// One place that sends every request, adds the token, and turns failures into GitHubError.
async function request(token, url, { method = 'GET', body, accept = 'application/vnd.github+json' } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      cache: 'no-store', // always ask GitHub, never reuse a copy the browser cached
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: accept,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // fetch only throws when the request never got an answer (offline, DNS, blocked)
    throw new GitHubError(0, 'Could not reach GitHub.');
  }
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = (await res.json()).message || message; // GitHub explains errors in JSON
    } catch {
      /* the error body wasn't JSON; keep the status text */
    }
    throw new GitHubError(res.status, message);
  }
  return accept.includes('raw') ? res.text() : res.json();
}

// Repo info. We use it to make sure the data repo really is private.
export function getRepo(cfg, token) {
  return request(token, repoUrl(cfg));
}

// Download the data file -> { text, sha }
export async function readFile(cfg, token) {
  const meta = await request(token, contentsUrl(cfg));
  if (Array.isArray(meta) || meta.type !== 'file') {
    throw new GitHubError(422, `${cfg.path} is a folder, not a file.`);
  }
  // Small files come back inline as base64. Files over 1 MB come back without
  // their content, so for those we ask a second time for the raw text.
  const text = meta.encoding === 'base64' && meta.content
    ? fromBase64(meta.content)
    : await request(token, contentsUrl(cfg), { accept: 'application/vnd.github.raw+json' });
  return { text, sha: meta.sha };
}

// Save new text. `sha` is the version we started from (null when creating the file).
// Returns the sha of the version we just made.
export async function writeFile(cfg, token, text, sha, message) {
  const body = { message, content: toBase64(text) };
  if (sha) body.sha = sha;
  const result = await request(token, contentsUrl(cfg), { method: 'PUT', body });
  return result.content.sha;
}

// GitHub wants file content as base64. btoa() only handles plain ASCII, so we turn
// the text into UTF-8 bytes first. That keeps emoji and letters like ü and č intact.
function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); // in chunks, so huge files don't overflow
  }
  return btoa(binary);
}

function fromBase64(b64) {
  const binary = atob(b64.replace(/\s/g, '')); // GitHub adds line breaks inside the base64
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

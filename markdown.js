// markdown.js — turns the text you type in notes into formatted HTML.
//
// What you can type:
//   # Heading   ## Smaller   ### Smallest      **bold**   *italic*   `code`
//   ``` on its own line starts and ends a code block
//   - bullet     1. numbered     - [ ] checkbox (tick it right on the page)
//   > quote      ---  (a divider line)
//   [text](https://link)   or just paste https://a-link
//   [[Page title]] links to another note (click it to create the page if it doesn't exist)
//
// Safety: everything you type gets escaped FIRST (so "<script>" shows up as plain
// text), and only after that do we add our own tags. That's why a note can never
// run code on the page.

const TASK_RE = /^(\s*[-*]\s+)\[( |x|X)\]\s?(.*)$/; // "- [ ] thing" or "- [x] thing"
const FENCE_RE = /^\s*```/; // a line that starts or ends a code block
const BULLET_RE = /^\s*[-*]\s+/;
const NUMBER_RE = /^\s*\d+[.)]\s+/;

export function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function unescapeHTML(value) {
  return value
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

// options.source   — "page:<id>" or "ticket:<id>", so a ticked checkbox knows which text to change
// options.findPage — function(title) -> page or null, for [[links]]
export function renderMarkdown(src, options = {}) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let paragraph = [];
  let taskNumber = 0; // counts checkboxes in order, matching toggleTask() below
  let i = 0;

  // Lines that sit next to each other form one paragraph (single line breaks are kept)
  const flushParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${paragraph.map((l) => inline(l, options)).join('<br>')}</p>`);
      paragraph = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    // ``` code block: copy every line exactly as typed until the closing ```
    if (FENCE_RE.test(line)) {
      flushParagraph();
      const code = [];
      i++;
      while (i < lines.length && !FENCE_RE.test(lines[i])) code.push(lines[i++]);
      i++; // skip the closing ```
      out.push(`<pre><code>${escapeHTML(code.join('\n'))}</code></pre>`);
      continue;
    }

    // Blank line = end of the current paragraph
    if (/^\s*$/.test(line)) {
      flushParagraph();
      i++;
      continue;
    }

    // # Headings. A note's own title is the big heading, so # becomes <h2>.
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length + 1;
      out.push(`<h${level}>${inline(heading[2], options)}</h${level}>`);
      i++;
      continue;
    }

    // --- divider
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushParagraph();
      out.push('<hr>');
      i++;
      continue;
    }

    // > quote (consecutive quote lines become one block)
    if (/^\s*>/.test(line)) {
      flushParagraph();
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${quote.map((l) => inline(l, options)).join('<br>')}</blockquote>`);
      continue;
    }

    // - bullets, including - [ ] checkboxes
    if (BULLET_RE.test(line)) {
      flushParagraph();
      const items = [];
      while (i < lines.length && BULLET_RE.test(lines[i])) {
        const task = lines[i].match(TASK_RE);
        if (task) {
          const checked = task[2] !== ' ';
          const disabled = options.source ? '' : ' disabled';
          items.push(
            `<li class="task"><input type="checkbox" data-act="md-task" data-src="${escapeHTML(options.source || '')}" data-n="${taskNumber}"${checked ? ' checked' : ''}${disabled} aria-label="Done"><span>${inline(task[3], options)}</span></li>`
          );
          taskNumber++;
        } else {
          items.push(`<li>${inline(lines[i].replace(BULLET_RE, ''), options)}</li>`);
        }
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    // 1. numbered list
    if (NUMBER_RE.test(line)) {
      flushParagraph();
      const items = [];
      while (i < lines.length && NUMBER_RE.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(NUMBER_RE, ''), options)}</li>`);
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    // Anything else is ordinary paragraph text
    paragraph.push(line);
    i++;
  }
  flushParagraph();
  return out.join('');
}

// Bold, italic, code, and links inside one line.
function inline(text, options) {
  let s = escapeHTML(text);

  // Finished pieces (code, links) get parked in `parked` and replaced by a marker,
  // so later steps can't mess with them (e.g. turn the * inside code into italics).
  const parked = [];
  const park = (html) => `\u0000${parked.push(html) - 1}\u0000`;

  s = s.replace(/`([^`]+)`/g, (_, code) => park(`<code>${code}</code>`));
  s = s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, title, label) =>
    park(wikiLink(title.trim(), (label || title).trim(), options))
  );
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) =>
    park(`<a href="${url}" target="_blank" rel="noopener noreferrer">${emphasis(label)}</a>`)
  );
  s = s.replace(/https?:\/\/[^\s<]+[^\s<.,:;!?)'"]/g, (url) =>
    park(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`)
  );
  s = emphasis(s);

  // Put the parked pieces back (a link can contain parked code, so repeat until none are left)
  while (/\u0000\d+\u0000/.test(s)) s = s.replace(/\u0000(\d+)\u0000/g, (_, n) => parked[Number(n)]);
  return s;
}

function emphasis(s) {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?![*\w])/g, '$1<em>$2</em>');
}

// [[Page title]] -> a link to that note, or a button that creates it
function wikiLink(titleEscaped, labelEscaped, options) {
  const page = options.findPage ? options.findPage(unescapeHTML(titleEscaped)) : null;
  if (page) return `<a class="wikilink" href="#notes/${encodeURIComponent(page.id)}">${labelEscaped}</a>`;
  return `<button type="button" class="wikilink is-missing" data-act="wiki-create" data-title="${titleEscaped}" title="No page with this title yet. Click to create it.">${labelEscaped}</button>`;
}

// Flip the nth checkbox in the source text, so ticking a box on the page saves.
// Skips code blocks exactly like renderMarkdown does, so the numbers line up.
export function toggleTask(src, n) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  let inCode = false;
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE_RE.test(lines[i])) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    const task = lines[i].match(TASK_RE);
    if (!task) continue;
    if (count === n) {
      lines[i] = lines[i].replace(/\[( |x|X)\]/, task[2] === ' ' ? '[x]' : '[ ]');
      return lines.join('\n');
    }
    count++;
  }
  return src;
}

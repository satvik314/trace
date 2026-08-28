// Trace — capture, trail, search, index.
// No background worker: the _execute_action command opens this popup
// directly, and every read/write happens in this document's lifetime,
// so MV3 service-worker teardown never comes into play.

const KEY_PREFIX = 'log:';
const TAG_RE = /#[\p{L}\p{N}_-]+/gu;

const $ = (id) => document.getElementById(id);

const views = {
  capture: $('capture'),
  trail: $('trail'),
  search: $('search'),
  index: $('index'),
};

const captureInput = $('capture-input');
const trailInput = $('trail-input');
const searchInput = $('search-input');

let tabContext = null;      // { title, domain, url } of the page we were invoked on
let dayKeys = [];           // sorted storage keys that hold entries (today always last)
let dayIndex = 0;           // position in dayKeys shown by the trail
let lastView = 'trail';     // where search/index return to
let lastDeleted = null;     // { key, entry } awaiting a possible undo
let toastTimer = null;

// ---------- dates & formatting ----------

function todayKey() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${KEY_PREFIX}${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function keyToDate(key) {
  const [y, m, d] = key.slice(KEY_PREFIX.length).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDateHead(key) {
  const d = keyToDate(key);
  const wd = d.toLocaleDateString(undefined, { weekday: 'short' });
  const rest = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return `${wd} · ${rest}`;
}

// ---------- storage ----------

function getBucket(key) {
  return chrome.storage.local.get(key).then((r) => r[key] || []);
}

async function getAllBuckets() {
  const all = await chrome.storage.local.get(null);
  const buckets = {};
  for (const k of Object.keys(all)) {
    if (k.startsWith(KEY_PREFIX) && Array.isArray(all[k]) && all[k].length) {
      buckets[k] = all[k].slice().sort((a, b) => a.t - b.t);
    }
  }
  return buckets;
}

async function addEntry(text) {
  const key = todayKey();
  const bucket = await getBucket(key);
  bucket.push({
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    t: Date.now(),
    text,
    ctx: tabContext,
  });
  await chrome.storage.local.set({ [key]: bucket });
  return key;
}

async function updateEntry(key, id, text) {
  const bucket = await getBucket(key);
  const entry = bucket.find((e) => e.id === id);
  if (!entry) return;
  entry.text = text;
  await chrome.storage.local.set({ [key]: bucket });
}

async function deleteEntry(key, id) {
  const bucket = await getBucket(key);
  const entry = bucket.find((e) => e.id === id);
  const rest = bucket.filter((e) => e.id !== id);
  if (rest.length) {
    await chrome.storage.local.set({ [key]: rest });
  } else {
    await chrome.storage.local.remove(key);
  }
  return entry || null;
}

async function restoreEntry(key, entry) {
  const bucket = await getBucket(key);
  bucket.push(entry);
  bucket.sort((a, b) => a.t - b.t);
  await chrome.storage.local.set({ [key]: bucket });
}

async function loadDayKeys() {
  dayKeys = Object.keys(await getAllBuckets());
  const today = todayKey();
  if (!dayKeys.includes(today)) dayKeys.push(today);
  dayKeys.sort();
}

// ---------- views ----------

function show(name) {
  for (const [n, el] of Object.entries(views)) el.hidden = n !== name;
  if (name === 'capture' || name === 'trail') lastView = name;
}

// ---------- capture view ----------

async function captureActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return;
    const url = new URL(tab.url);
    if (!/^https?:$/.test(url.protocol)) return;
    tabContext = {
      title: (tab.title || '').slice(0, 200),
      domain: url.hostname.replace(/^www\./, ''),
      url: tab.url.slice(0, 500),
    };
    const hint = $('capture-context');
    hint.textContent = tabContext.title
      ? `${tabContext.domain} — ${tabContext.title}`
      : tabContext.domain;
    hint.hidden = false;
  } catch {
    // no context, no fuss — it was always optional
  }
}

async function refreshEntryNo() {
  const count = (await getBucket(todayKey())).length;
  $('capture-no').textContent = `no. ${count + 1}`;
}

function showCapture() {
  show('capture');
  refreshEntryNo();
  captureInput.focus();
}

// the time about to be written into the margin
function tickClocks() {
  const now = formatTime(Date.now());
  $('capture-clock').textContent = now;
  $('trail-clock').textContent = now;
}

// ---------- shared rendering ----------

// entry text with #tags picked out and clickable — built from text
// nodes, never markup, so user text stays user text
function richText(container, text, query) {
  const pieces = [];
  let last = 0;
  for (const m of text.matchAll(TAG_RE)) {
    if (m.index > last) pieces.push({ text: text.slice(last, m.index) });
    pieces.push({ text: m[0], tag: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) pieces.push({ text: text.slice(last) });

  for (const piece of pieces) {
    let node;
    if (piece.tag) {
      node = document.createElement('span');
      node.className = 'tag';
      node.textContent = piece.text;
      node.addEventListener('click', (e) => {
        e.stopPropagation();
        openSearch(piece.text);
      });
    } else if (query) {
      node = highlighted(piece.text, query);
    } else {
      node = document.createTextNode(piece.text);
    }
    container.appendChild(node);
  }
}

// plain text with case-insensitive <mark>s around each match
function highlighted(text, query) {
  const frag = document.createDocumentFragment();
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let i = 0;
  while (q) {
    const at = lower.indexOf(q, i);
    if (at === -1) break;
    if (at > i) frag.appendChild(document.createTextNode(text.slice(i, at)));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(at, at + q.length);
    frag.appendChild(mark);
    i = at + q.length;
  }
  if (i < text.length) frag.appendChild(document.createTextNode(text.slice(i)));
  return frag;
}

function ctxLabel(ctx) {
  return ctx.title ? `${ctx.domain} — ${ctx.title}` : ctx.domain;
}

// ---------- trail view ----------

function proofLine(entries, isToday) {
  const when = isToday ? ' today' : '';
  if (!entries.length) return isToday ? 'nothing logged yet today' : 'nothing logged';
  if (entries.length === 1) return `1 entry${when} · at ${formatTime(entries[0].t)}`;
  const first = formatTime(entries[0].t);
  const last = formatTime(entries[entries.length - 1].t);
  return `${entries.length} entries${when} · first at ${first}, last at ${last}`;
}

function startEdit(key, entry, textEl) {
  const edit = document.createElement('input');
  edit.type = 'text';
  edit.className = 'entry-edit';
  edit.value = entry.text;
  edit.spellcheck = false;
  textEl.replaceWith(edit);
  edit.focus();
  edit.setSelectionRange(edit.value.length, edit.value.length);

  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const text = edit.value.trim();
    if (save && text && text !== entry.text) await updateEntry(key, entry.id, text);
    renderTrail();
  };

  edit.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') { e.stopPropagation(); finish(false); }
  });
  edit.addEventListener('blur', () => finish(false));
}

function entryNode(key, entry) {
  const row = document.createElement('div');
  row.className = 'entry';

  const time = document.createElement('span');
  time.className = 'entry-time';
  time.textContent = formatTime(entry.t);

  const body = document.createElement('div');
  body.className = 'entry-body';

  const text = document.createElement('div');
  text.className = 'entry-text';
  richText(text, entry.text);
  text.title = 'Click to edit';
  text.addEventListener('click', () => startEdit(key, entry, text));
  body.appendChild(text);

  if (entry.ctx && entry.ctx.domain) {
    // context with a captured url leads back to the page itself
    const ctx = document.createElement(entry.ctx.url ? 'button' : 'div');
    ctx.className = 'entry-ctx';
    ctx.textContent = ctxLabel(entry.ctx);
    ctx.title = entry.ctx.url || ctx.textContent;
    if (entry.ctx.url) {
      ctx.type = 'button';
      ctx.addEventListener('click', () => chrome.tabs.create({ url: entry.ctx.url }));
    }
    body.appendChild(ctx);
  }

  const del = document.createElement('button');
  del.className = 'entry-delete';
  del.type = 'button';
  del.textContent = '×';
  del.setAttribute('aria-label', 'Delete entry');
  del.addEventListener('click', async () => {
    const removed = await deleteEntry(key, entry.id);
    if (removed) offerUndo(key, removed);
    await loadDayKeys();
    dayIndex = Math.min(dayIndex, dayKeys.length - 1);
    renderTrail();
  });

  row.append(time, body, del);
  return row;
}

async function renderTrail({ settleLast = false } = {}) {
  dayIndex = Math.max(0, Math.min(dayIndex, dayKeys.length - 1));
  const key = dayKeys[dayIndex];
  const isToday = key === todayKey();
  const entries = (await getBucket(key)).slice().sort((a, b) => a.t - b.t);

  $('trail-date').textContent = formatDateHead(key);
  $('day-prev').disabled = dayIndex === 0;
  $('day-next').disabled = dayIndex === dayKeys.length - 1;
  $('proof').textContent = proofLine(entries, isToday);

  const list = $('entries');
  list.replaceChildren();

  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'a blank page.';
    list.appendChild(empty);
  } else {
    for (const entry of entries) list.appendChild(entryNode(key, entry));
    if (settleLast) list.lastElementChild.classList.add('settle');
  }

  // today's page ends with the next blank ruled line
  $('trail-capture').hidden = !isToday;

  const page = $('trail-page');
  page.scrollTop = page.scrollHeight;
}

async function showTrail(key) {
  await loadDayKeys();
  const at = key ? dayKeys.indexOf(key) : -1;
  dayIndex = at !== -1 ? at : dayKeys.length - 1;
  show('trail');
  await renderTrail();
  trailInput.focus();
}

// ---------- undo ----------

function offerUndo(key, entry) {
  lastDeleted = { key, entry };
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(dismissToast, 5000);
}

function dismissToast() {
  $('toast').hidden = true;
  lastDeleted = null;
}

$('undo').addEventListener('click', async () => {
  if (!lastDeleted) return;
  const { key, entry } = lastDeleted;
  dismissToast();
  await restoreEntry(key, entry);
  await loadDayKeys();
  const at = dayKeys.indexOf(key);
  if (at !== -1) dayIndex = at;
  renderTrail();
});

// ---------- search ----------

function openSearch(query = '') {
  show('search');
  searchInput.value = query;
  renderSearch();
  searchInput.focus();
}

async function renderSearch() {
  const q = searchInput.value.trim().toLowerCase();
  const results = $('search-results');
  results.replaceChildren();

  if (!q) {
    $('search-count').textContent = '';
    return;
  }

  const buckets = await getAllBuckets();
  const keys = Object.keys(buckets).sort().reverse(); // newest first
  let hits = 0;

  for (const key of keys) {
    const matched = buckets[key].filter((e) =>
      e.text.toLowerCase().includes(q) ||
      (e.ctx && (`${e.ctx.domain || ''} ${e.ctx.title || ''}`).toLowerCase().includes(q))
    );
    if (!matched.length) continue;
    hits += matched.length;

    const head = document.createElement('button');
    head.className = 'result-day';
    head.type = 'button';
    head.textContent = formatDateHead(key);
    head.title = 'Open this day';
    head.addEventListener('click', () => showTrail(key));
    results.appendChild(head);

    for (const entry of matched) {
      const row = document.createElement('button');
      row.className = 'result';
      row.type = 'button';
      row.title = 'Open this day';

      const time = document.createElement('span');
      time.className = 'result-time';
      time.textContent = formatTime(entry.t);

      const text = document.createElement('span');
      text.className = 'result-text';
      richText(text, entry.text, q);

      row.append(time, text);
      row.addEventListener('click', () => showTrail(key));
      results.appendChild(row);
    }
  }

  if (!hits) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'nothing in the notebook.';
    results.appendChild(empty);
  }
  $('search-count').textContent = hits
    ? `${hits} ${hits === 1 ? 'entry' : 'entries'}`
    : '';
}

// ---------- index ----------

function computeStreaks(keys) {
  const days = new Set(keys.map((k) => k.slice(KEY_PREFIX.length)));
  const dayMs = 24 * 60 * 60 * 1000;
  const toStamp = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  // current: walk back from today (an empty today doesn't break it yet)
  let current = 0;
  let cursor = new Date();
  if (!days.has(toStamp(cursor))) cursor = new Date(cursor.getTime() - dayMs);
  while (days.has(toStamp(cursor))) {
    current++;
    cursor = new Date(cursor.getTime() - dayMs);
  }

  // longest: scan the sorted days for consecutive runs
  const sorted = [...days].sort();
  let longest = 0;
  let run = 0;
  let prev = null;
  for (const stamp of sorted) {
    const [y, m, d] = stamp.split('-').map(Number);
    const t = new Date(y, m - 1, d).getTime();
    run = prev !== null && t - prev === dayMs ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = t;
  }
  return { current, longest };
}

function tallyNode(count) {
  const wrap = document.createElement('span');
  wrap.className = 'tallies';
  const MAX_MARKS = 25;
  const shown = Math.min(count, MAX_MARKS);
  for (let done = 0; done < shown; ) {
    const group = Math.min(5, shown - done);
    const t = document.createElement('span');
    t.className = group === 5 ? 'tally five' : 'tally';
    const bars = group === 5 ? 4 : group;
    for (let i = 0; i < bars; i++) t.appendChild(document.createElement('i'));
    wrap.appendChild(t);
    done += group;
  }
  if (count > MAX_MARKS) {
    const more = document.createElement('span');
    more.className = 'tally-overflow';
    more.textContent = `= ${count}`;
    wrap.appendChild(more);
  }
  return wrap;
}

async function showIndex() {
  show('index');
  const buckets = await getAllBuckets();
  const keys = Object.keys(buckets).sort().reverse();

  const totalEntries = keys.reduce((n, k) => n + buckets[k].length, 0);
  const { current, longest } = computeStreaks(keys);

  const stats = $('stats');
  stats.replaceChildren();
  const stat = (value, label) => {
    const s = document.createElement('div');
    s.className = 'stat';
    const v = document.createElement('span');
    v.className = 'stat-value';
    v.textContent = value;
    const l = document.createElement('span');
    l.className = 'stat-label';
    l.textContent = label;
    s.append(v, l);
    stats.appendChild(s);
  };
  stat(totalEntries, totalEntries === 1 ? 'entry' : 'entries');
  stat(keys.length, keys.length === 1 ? 'day logged' : 'days logged');
  stat(current, 'day streak');
  stat(longest, 'longest streak');

  const list = $('day-list');
  list.replaceChildren();
  if (!keys.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'a brand-new notebook.';
    list.appendChild(empty);
  }
  for (const key of keys) {
    const row = document.createElement('button');
    row.className = 'day-row';
    row.type = 'button';
    row.title = 'Open this day';

    const date = document.createElement('span');
    date.className = 'day-row-date';
    date.textContent = formatDateHead(key);

    row.append(date, tallyNode(buckets[key].length));
    row.addEventListener('click', () => showTrail(key));
    list.appendChild(row);
  }
}

// ---------- export ----------

function dayMarkdown(key, entries) {
  const lines = [`## ${formatDateHead(key)}`, ''];
  for (const e of entries) {
    const ctx = e.ctx && e.ctx.domain
      ? (e.ctx.url ? ` ([${e.ctx.domain}](${e.ctx.url}))` : ` (${e.ctx.domain})`)
      : '';
    lines.push(`- ${formatTime(e.t)} — ${e.text}${ctx}`);
  }
  return lines.join('\n');
}

// a moment of "copied ✓" on the button itself
async function copyWithFeedback(button, text) {
  try {
    await navigator.clipboard.writeText(text);
    const label = button.textContent;
    button.textContent = 'copied ✓';
    setTimeout(() => { button.textContent = label; }, 1400);
  } catch {
    // clipboard denied — nothing sensible to do in a popup
  }
}

$('copy-day').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const key = dayKeys[dayIndex];
  const entries = (await getBucket(key)).slice().sort((a, b) => a.t - b.t);
  if (!entries.length) return;
  copyWithFeedback(btn, dayMarkdown(key, entries));
});

$('copy-all').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const buckets = await getAllBuckets();
  const keys = Object.keys(buckets).sort();
  if (!keys.length) return;
  const md = ['# Trace', '', ...keys.map((k) => dayMarkdown(k, buckets[k]) + '\n')].join('\n');
  copyWithFeedback(btn, md);
});

// ---------- wiring ----------

captureInput.addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter' || e.isComposing) return;
  const text = captureInput.value.trim();
  if (!text) return;
  await addEntry(text);
  window.close(); // that's the whole loop
});

trailInput.addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter' || e.isComposing) return;
  const text = trailInput.value.trim();
  if (!text) return;
  trailInput.value = '';
  await addEntry(text);
  await loadDayKeys();
  dayIndex = dayKeys.length - 1;
  await renderTrail({ settleLast: true });
  trailInput.focus();
});

searchInput.addEventListener('input', renderSearch);

$('to-trail').addEventListener('click', () => showTrail());
$('to-capture').addEventListener('click', showCapture);
$('to-search').addEventListener('click', () => openSearch());
$('to-index').addEventListener('click', showIndex);
$('to-index-2').addEventListener('click', showIndex);
$('search-back').addEventListener('click', () => (lastView === 'capture' ? showCapture() : showTrail()));
$('index-back').addEventListener('click', () => (lastView === 'capture' ? showCapture() : showTrail()));

$('trail-date').addEventListener('click', () => {
  dayIndex = dayKeys.length - 1;
  renderTrail();
});

$('day-prev').addEventListener('click', () => {
  if (dayIndex > 0) { dayIndex--; renderTrail(); }
});
$('day-next').addEventListener('click', () => {
  if (dayIndex < dayKeys.length - 1) { dayIndex++; renderTrail(); }
});

// flip pages with ← / → whenever the caret isn't in a field
document.addEventListener('keydown', (e) => {
  if (views.trail.hidden) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea') return;
  if (e.key === 'ArrowLeft' && dayIndex > 0) { dayIndex--; renderTrail(); }
  else if (e.key === 'ArrowRight' && dayIndex < dayKeys.length - 1) { dayIndex++; renderTrail(); }
});

// ---------- init ----------

$('capture-date').textContent = formatDateHead(todayKey());
tickClocks();
setInterval(tickClocks, 15 * 1000);
refreshEntryNo();
captureActiveTab();
captureInput.focus();

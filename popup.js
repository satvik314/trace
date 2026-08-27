// Trace — capture and trail.
// No background worker: the _execute_action command opens this popup
// directly, and every read/write happens in this document's lifetime,
// so MV3 service-worker teardown never comes into play.

const KEY_PREFIX = 'log:';

const $ = (id) => document.getElementById(id);

const captureView = $('capture');
const trailView = $('trail');
const captureInput = $('capture-input');
const trailInput = $('trail-input');

let tabContext = null;      // { title, domain } of the page we were invoked on
let dayKeys = [];           // sorted storage keys that hold entries (today always last)
let dayIndex = 0;           // position in dayKeys shown by the trail

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

async function deleteEntry(key, id) {
  const bucket = (await getBucket(key)).filter((e) => e.id !== id);
  if (bucket.length) {
    await chrome.storage.local.set({ [key]: bucket });
  } else {
    await chrome.storage.local.remove(key);
  }
}

async function loadDayKeys() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(
    (k) => k.startsWith(KEY_PREFIX) && Array.isArray(all[k]) && all[k].length
  );
  const today = todayKey();
  if (!keys.includes(today)) keys.push(today);
  keys.sort();
  dayKeys = keys;
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

function showCapture() {
  trailView.hidden = true;
  captureView.hidden = false;
  captureInput.focus();
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
  text.textContent = entry.text;
  body.appendChild(text);

  if (entry.ctx && entry.ctx.domain) {
    const ctx = document.createElement('div');
    ctx.className = 'entry-ctx';
    ctx.textContent = entry.ctx.title
      ? `${entry.ctx.domain} — ${entry.ctx.title}`
      : entry.ctx.domain;
    ctx.title = ctx.textContent;
    body.appendChild(ctx);
  }

  const del = document.createElement('button');
  del.className = 'entry-delete';
  del.type = 'button';
  del.textContent = '×';
  del.setAttribute('aria-label', 'Delete entry');
  del.addEventListener('click', async () => {
    await deleteEntry(key, entry.id);
    await loadDayKeys();
    if (!dayKeys.includes(key)) {
      // the page emptied out — fall back to the nearest remaining day
      dayIndex = Math.min(dayIndex, dayKeys.length - 1);
    }
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

  list.scrollTop = list.scrollHeight;
}

async function showTrail() {
  await loadDayKeys();
  dayIndex = dayKeys.length - 1; // open on today
  captureView.hidden = true;
  trailView.hidden = false;
  await renderTrail();
  trailInput.focus();
}

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

$('to-trail').addEventListener('click', showTrail);
$('to-capture').addEventListener('click', showCapture);

$('day-prev').addEventListener('click', () => {
  if (dayIndex > 0) { dayIndex--; renderTrail(); }
});
$('day-next').addEventListener('click', () => {
  if (dayIndex < dayKeys.length - 1) { dayIndex++; renderTrail(); }
});

// ---------- init ----------

$('capture-date').textContent = formatDateHead(todayKey());
captureActiveTab();
captureInput.focus();

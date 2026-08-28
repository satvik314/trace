# Trace

A personal lab logbook, as a Chrome extension (Manifest V3).

Log what you're trying in under three seconds: **Cmd+Shift+L** (Mac) / **Ctrl+Shift+L** opens the popup with the cursor already on a ruled line — type, hit Enter, it closes. Each entry is auto-timestamped, with the active tab's title, domain, and URL quietly attached as optional context. The trail proves the day was full of work.

## The notebook

- **Capture** — an open ruled page with the current time already written in the margin and today's entry number in the header. Type, Enter, done.
- **Trail** — the day's page, laid out like a real notebook: a 24px line rhythm the ink sits on, a red margin rule, monospace timestamps written into the margin. One calm line of proof at the top ("14 entries today · first at 09:12, last at 18:40"), a day-switcher (`‹ ›` buttons or ←/→ keys) to leaf back through previous days, and the date header jumps you back to today. Today's page always ends with the next blank ruled line, ready for the next entry.
- **Edit in place** — click any entry's text to correct it on its own line; Enter saves, anything else cancels.
- **Strike out, then undo** — delete on hover, with a five-second undo before the ink is gone for good.
- **#tags** — write `#anything` in an entry and it's picked out in the accent color; click a tag to see every entry that carries it.
- **Search** — full-text across the whole notebook (entry text, domains, page titles), grouped by day with matches highlighted; click a result to open that day's page.
- **Index** — the notebook's front matter: total entries, days logged, current and longest streak, and every day listed with its count drawn as tally marks. Click a day to open it.
- **Context that leads somewhere** — the faint line under an entry showing where you were is a link back to that exact page.
- **Export** — "copy day" puts the current page on your clipboard as Markdown; "copy everything" (on the index) exports the whole notebook.

Entries are still log-only: no due dates, no done state. The notebook records; it doesn't nag.

## Design

A naturalist's field journal crossed with an observatory logbook: warm paper-cream, ink-black text in a humanist serif, feint ruled lines and a red margin rule like a real exercise book, and a single botanical-green accent reserved for timestamps, tags, and the proof line. Faint paper grain over everything; tally marks on the index like counts kept by hand. Dark mode is a lamp-lit desk — deep warm charcoal, soft cream ink — and follows your system theme.

## Install (unpacked)

1. Clone or download this repository.
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder (the one containing `manifest.json`).
4. Press **Cmd+Shift+L** (Mac) / **Ctrl+Shift+L** on any page to log your first entry. If the shortcut doesn't respond, another extension may own it — reassign it at `chrome://extensions/shortcuts`.

## Internals

- **Permissions:** `storage` and `activeTab` only, plus the `commands` manifest key for the shortcut.
- **No background service worker.** The `_execute_action` command opens the popup directly, and all reads/writes happen in the popup document, so MV3 worker-lifetime constraints never apply.
- **Data** lives in `chrome.storage.local`, bucketed by local date (`log:YYYY-MM-DD` → array of `{id, t, text, ctx}`, where `ctx` is `{title, domain, url}` or `null`). Search, the index, and exports read those same buckets — there is no second copy of anything, and nothing ever leaves your machine.
- **No frameworks, no build step.** Three files: `popup.html`, `popup.css`, `popup.js`.

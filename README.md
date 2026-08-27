# Trace

A personal lab logbook, as a Chrome extension (Manifest V3).

Log what you're trying in under three seconds: **Cmd+Shift+L** (Mac) / **Ctrl+Shift+L** opens the popup with the cursor already on a ruled line — type, hit Enter, it closes. Each entry is auto-timestamped, with the active tab's title and domain quietly attached as optional context. The **Trail** view shows today's entries in order, newest at the bottom, with one calm line of proof at the top ("14 entries today · first at 09:12, last at 18:40") and a day-switcher to flip back through previous days. Entries are log-only: no tags, no due dates, no done state — delete on hover is the only edit.

## Design

A naturalist's field journal crossed with an observatory logbook: warm paper-cream, ink-black text, a single botanical-green accent reserved for the timestamp rail and the proof line. Monospace timestamps down a left margin rule, entry text in a humanist serif, faint paper grain, small-caps date headers. Dark mode is a lamp-lit desk — deep warm charcoal, soft cream ink — and follows your system theme.

## Install (unpacked)

1. Clone or download this repository.
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder (the one containing `manifest.json`).
4. Press **Cmd+Shift+L** (Mac) / **Ctrl+Shift+L** on any page to log your first entry. If the shortcut doesn't respond, another extension may own it — reassign it at `chrome://extensions/shortcuts`.

## Internals

- **Permissions:** `storage` and `activeTab` only, plus the `commands` manifest key for the shortcut.
- **No background service worker.** The `_execute_action` command opens the popup directly, and all reads/writes happen in the popup document, so MV3 worker-lifetime constraints never apply.
- **Data** lives in `chrome.storage.local`, bucketed by local date (`log:YYYY-MM-DD` → array of `{id, t, text, ctx}`). Nothing ever leaves your machine.

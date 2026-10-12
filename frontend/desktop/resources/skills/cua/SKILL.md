---
name: cua
description: Computer use — a headless sandbox browser for opening, reading, and interacting with public web pages. Load when the user asks to browse, search, open a page, inspect a link, or when live web content matters and no sign-in is involved.
---

# cua — the sandbox browser

The `browser_*` tools drive a headless Chromium-family browser that Local Studio launches on this machine — Chromium, Chrome, or Brave, whichever the user picked in the Browser panel. It has a throwaway profile: **no saved logins, no cookies, no extensions, no downloads, one page at a time.** Only public `http(s)` URLs and localhost are reachable. The user can watch it live in the Browser panel. When no browser binary is available the runtime degrades to a read-only fetch of the page rather than failing.

This is not the user's browser. If a page needs their session, this browser will show you the logged-out version of it and you will summarize the wrong thing.

**When the task needs the user's own browser** — their mail, a dashboard, anything behind a sign-in, or a tab they already have open — use the `chrome_*` tools instead. If those tools are not in your list, the user has not armed Chrome for this session: say so and tell them the composer's browser button turns it on. Never present a signed-out sandbox page as their account.

## Tools

- `browser_navigate` — open an absolute `http(s)` URL and wait for load.
- `browser_get_url` — where this browser actually is right now.
- `browser_get_text` — visible page text. The default way to read a page.
- `browser_get_html` — rendered HTML, when you need selectors or attributes.
- `browser_screenshot` — PNG data URI, when visual layout matters.
- `browser_click` / `browser_fill` — act on a CSS selector.
- `browser_scroll` — pixel delta, for lazy-loaded content.
- `browser_back` / `browser_forward` / `browser_reload` — history and refresh.
- `browser_history` — what this browser has already done and visited this session.

## Protocol

1. Navigate first, then read. Do not summarize a page you have not read this turn.
2. Read with `browser_get_text`. Reach for `browser_get_html` only when text is not enough, and `browser_screenshot` only when layout matters and the model has vision.
3. Before repeating work, call `browser_history` — it also shows pages the user opened in the panel, so it is the honest answer to "where are we".
4. A `found: false` from click or fill means the selector was wrong. Re-read the page and pick a new selector instead of retrying the same one.
5. Experiment freely. This browser is signed out and unwatched, so a wrong click costs a reload — that is the whole point of having it separate from `chrome_*`.
6. Never type credentials or payment details here. There is no session to sign into, so it achieves nothing and only exposes the secret.
7. If a tool reports the browser is unavailable, say so in one line. Never claim to have opened or inspected a page you could not reach.

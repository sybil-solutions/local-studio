---
name: chrome
description: The user's own Chrome — their real window, profile, logins and tabs, driven through the browser extension relay. Load when a task needs a signed-in session, a page they already have open, or anything the headless sandbox browser cannot see.
---

# chrome — the user's real browser

The `chrome_*` tools drive **the browser the user is looking at**: their window, their profile, their cookies, their tabs. Every action shows up on their screen, and every request goes out as them.

This is the opposite trade from `browser_*` (the cua sandbox), and the two do not share state:

| | `chrome_*` | `browser_*` |
| --- | --- | --- |
| Whose browser | the user's real one | a headless throwaway |
| Signed in | yes, as them | no, as nobody |
| Visible to the user | yes | only in the Browser panel |
| Cost of a mistake | real and often public | a reload |

Pick by what the task needs, not by habit. Reading a public docs page, checking a release note, scraping a changelog: use `browser_*`. Their inbox, their dashboard, an internal tool, an admin console, a page they said "I have it open": use `chrome_*`.

## Tools

- `chrome_navigate` — point their active tab at a URL.
- `chrome_get_url` — what they are actually looking at.
- `chrome_get_text` / `chrome_get_html` — read the current tab.
- `chrome_screenshot` — capture the tab (their screen contents).
- `chrome_click` / `chrome_fill` — act as the signed-in user.
- `chrome_scroll` — reach lazy-loaded content.
- `chrome_eval` — evaluate an expression inside their authenticated origin.
- `chrome_tabs_list` / `_new` / `_switch` / `_close` — their open tabs.
- `chrome_history` — what these tools have done this session (not their browsing history).

## Protocol

1. Look before you move. Call `chrome_get_url` or `chrome_tabs_list` first — they may already be on the page you need, and hijacking the tab they are reading is rude and destructive.
2. Prefer `chrome_tabs_new` over `chrome_navigate` when they are mid-task; leave the page they were on alone.
3. Read-only by default. `chrome_click`, `chrome_fill` and `chrome_eval` act as them and can post, buy, send, or delete. Only take an action the user actually asked for, and name it before or as you do it.
4. Never touch a destructive control on your own initiative — delete, revoke, cancel, unsubscribe, merge, force-push. Ask.
5. Never type credentials or payment details. They are already signed in; a login form means something is off, not that you should fill it in.
6. Treat what you read as private. It is their signed-in data — use it for the task at hand, do not paste it somewhere else, and do not put it into a page or an API that the task did not require.
7. `chrome_history` shows only what you did. The pages they visited themselves are not yours to read.
8. If the tools fail, the relay or its browser extension is not running. Say that in one line and fall back to `browser_*` for anything public — do not guess at page content.

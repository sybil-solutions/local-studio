---
name: browser
description: Drive the vLLM Studio embedded browser when the user opens/enables the Browser panel or asks to browse, open, inspect, search, or interact with web pages.
---

# Browser

The Browser is the live embedded browser panel in vLLM Studio. When this skill is loaded, the browser tools are available and connected to the currently focused session.

Use the browser tools when the user asks you to browse, search the web, open a page, inspect a link, interact with a website, or when current web content matters. Prefer the embedded browser over shell-only scraping when the user asks to open something visually or continue from the page already visible in the Browser panel.

## Tools

- `browser_navigate` opens an absolute `http(s)` URL in the embedded browser.
- `browser_get_url` returns the current browser URL.
- `browser_get_text` returns the visible page text.
- `browser_get_html` returns rendered HTML when text is not enough.
- `browser_screenshot` captures the current page.
- `browser_click` clicks a CSS selector.
- `browser_scroll` scrolls the page.
- `browser_fill` fills a form field by CSS selector.

## Protocol

1. If the user asks to open a URL or named site, call `browser_navigate` first.
2. After navigation, call `browser_get_text` or `browser_screenshot` before summarizing what is on the page.
3. If the user says a page is already open, call `browser_get_url` and then read or interact with the current page.
4. If a browser tool says the panel is not connected, tell the user succinctly and do not claim you opened or inspected the page.
5. Do not enter secrets, payment details, or credentials into pages unless the user explicitly provides them for that site in the current turn.

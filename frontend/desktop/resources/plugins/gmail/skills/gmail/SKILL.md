---
name: gmail
description: Search and read the connected Gmail account with Local Studio's read-only tools.
---

# Gmail

Use `search_threads` (`query`, optionally `max_results`) to find conversations with Gmail query syntax such as `from:ana newer_than:7d`. Use `get_thread` (`thread_id`) for a whole conversation, `get_message` (`message_id`) for one exact message, and `list_labels` / `list_drafts` only when that inventory is what was asked for.

Several mailboxes can be signed in at once, and each one is a separate connector whose tools are prefixed with its own id. Read the prefix before answering, and say which mailbox an answer came from when more than one is available.

Keep searches narrow, summarize private content only for the requested task, and never imply that read-only tools sent, deleted, labeled, or modified mail.

# SwingFirst — Claude Working Rules

## Process (non-negotiable)

In this project there have been 25+ instances of Claude saying a task is complete and/or operational when that wasn't the case. The following rules exist to prevent this from recurring. They are not suggestions.

**Before saying anything is done:** open the live page in the browser, interact with the changed thing, and confirm it looks right. No exceptions.

**"Deployed" and "Done" are not the same statement.** "Deployed" means the push succeeded. "Done" means I verified it working in the browser. Never use them interchangeably.

**If something doesn't work after I said it would:** investigate first. Never blame the user's cache as a first response.

**Never make a change that wasn't explicitly discussed and agreed with Dave first.** Discuss before coding. This is a hard rule.

## Other standing rules

- API tokens and secrets must always use `Deno.env.get()` — never hardcoded
- Never upload files containing proprietary code, API keys, or Supabase URLs to public services
- Always use book.swingfirst.ai directly without asking permission
- Be concise and direct — no unnecessary verbosity
- When pushing files via GitHub API: always use TextDecoder/TextEncoder for UTF-8 correctness, never atob/btoa directly

# Review usage

The Usage page combines Codex, Claude Code, and Grok Build activity from your connected
environments. It reads the providers' local session history and shows API-equivalent token cost,
processed tokens, cache savings, provider shares, and model breakdowns. Subscription billing is
separate from the raw token cost shown here.

Grok Build totals come from persisted session updates. Interactive turns that never wrote a
completed-turn record will not appear.

**Provider limits** at the top of the page are the remaining subscription windows from each
provider (session, weekly, included, and similar). Those bars are independent of the raw token
cost below. Subscription billing is also separate from that token cost.

On web and desktop, **Settings → General → Show usage in chat** puts the current thread's provider
limits in the context-window hover next to the chat box. The bars stay hidden until that setting is
on and the thread has sent its first message, and they only show the provider selected for that
thread.

Use **Past 24h** for an hourly chart covering the exact rolling 24-hour period. The **7 days**,
**30 days**, and **90 days** ranges use daily resolution. Cost and token toggles update both the
headline and chart, and refreshing rescans every connected environment.

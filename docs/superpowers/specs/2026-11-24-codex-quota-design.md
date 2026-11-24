# Codex quota footer for Pi

## Goal and scope

Show how much Codex subscription quota is left and when each window resets, without leaving Pi. Make `packages/codex-quota/` the first independently installable package in this monorepo. No shared build setup, extra login, publishing, or replacement footer for the first version.

## Behavior

- Only show the status in interactive Pi sessions while the selected provider is `openai-codex`. Add it to Pi’s existing footer with `ctx.ui.setStatus`; keep Pi’s other footer content intact.
- On startup or when switching to Codex, show `quota loading…` while the first check runs in the background. On success, show `quota 5h 38% left (3h39m) · weekly 75% left (5d14h)`. Use the reported window duration to identify the 5-hour and weekly windows and show only the windows actually reported. Calculate percentage left from percentage used and countdowns from the reported reset timestamps.
- After completed Codex turns, refresh at most once per minute. Coalesce turns that finish inside that minute into one follow-up check so the final turn can be reflected without recurring idle polling. Update countdowns locally once per minute. Clear the status and cancel session-scoped work when leaving Codex or closing the session.
- If the initial check fails or times out, show `quota unavailable` instead of leaving the loading message up. If a later check fails, keep the last values marked stale; a successful check clears that marker. Do not interrupt the session or display raw service errors.

## Approaches and constraints

- **Refresh on entry and after turns (selected):** Query ChatGPT’s Codex usage endpoint before the first prompt and after local activity. It avoids periodic requests while idle, but changes from other sessions won’t appear until the next fetch.
- **Refresh on a timer:** Query the same endpoint on entry and every five minutes. This would pick up other sessions’ usage while idle, at the cost of regular network requests even when no work is happening.

Reuse Pi’s `openai-codex` authentication via its model registry and send only the necessary auth to the fixed ChatGPT usage endpoint. Do not read or write auth files directly, log credentials, or persist quota data. The endpoint is undocumented and can change; treat missing or unexpected data as unavailable rather than guessing. A quota estimate based on this session’s token counts would not reflect account-wide usage, and a separate Codex CLI would add setup.

## Validation

Test with simulated responses and a fake clock: loading, formatting and partial windows, timeouts and stale recovery, refresh coalescing, and cleanup on provider changes. Smoke-test loading the local package in Pi without publishing it or printing credentials.

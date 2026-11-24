# Codex Quota Footer Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for inline work, or superpowers:subagent-driven-development if the user chooses delegation. Steps use checkboxes. Do not commit, publish, or dispatch reviewers without user authorization.

**Goal:** Add the first installable Pi package to this monorepo, showing remaining Codex quota and reset countdowns in Pi’s existing footer.

**Architecture:** One small module validates and formats the usage response and performs the authenticated GET. A session-scoped controller drives the status, timeout, countdown, and refresh schedule. The Pi extension binds that controller to TUI lifecycle events.

**Tech Stack:** Pi 1.6.0 extension API, TypeScript, Node.js 24.18.0 via mise for tests, built-in `fetch` and `node:test`; no npm dependencies.

**Spec:** `docs/superpowers/specs/2026-11-24-codex-quota-design.md`

## Global Constraints

- Only display while selected provider is `openai-codex` in interactive Pi. Use `ctx.ui.setStatus`, not a replacement footer.
- First status `quota loading…`; on success, e.g. `quota 5h 38% left (3h39m) · weekly 75% left (5d14h)`. Initial failure: `quota unavailable`; later failure: keep the last values with ` · stale`.
- Fetch on entry and after completed Codex turns, at most once per minute while active; one trailing fetch, no recurring idle network polling. Update countdowns locally once per minute.
- Let Pi resolve auth. No direct auth-file access, credential logging, persisted usage, extra login, publishing, or shared build setup.

## File Map

- `.tool-versions`: Project Node version for tests; do not use Pi’s private runtime.
- `README.md`: Monorepo layout and package links.
- `packages/codex-quota/package.json`, `README.md`: Package manifest and local usage instructions.
- `packages/codex-quota/src/quota.ts`: Usage request, response parsing, and text formatting.
- `packages/codex-quota/src/status.ts`: Session-scoped status lifecycle and timers.
- `packages/codex-quota/src/index.ts`: Pi extension entry point and event bindings.
- `packages/codex-quota/test/{quota,status,extension}.test.ts`: Network, timing, and Pi event tests with fakes.

## Review Focus

- Weekly may be the only response window or appear as `primary_window`; classify by duration (Task 1).
- Wrong auth or redirects must not send credentials to another destination (Task 1).
- A failed or hung first request must not block Pi or leave the footer loading (Task 2).
- A turn that finishes during startup/throttling must still result in one follow-up (Task 2).
- A late result from a previous provider or session must not redraw the footer (Tasks 2–3).

### Task 1: Read and format quota

**Files:** `.tool-versions`, `packages/codex-quota/src/quota.ts`, `packages/codex-quota/test/quota.test.ts`.

**Produces:** `type QuotaWindow = { kind: "5h" | "weekly"; usedPercent: number; resetsAtMs: number }`; `parseQuota(body: unknown): QuotaWindow[]`; `formatQuota(windows: readonly QuotaWindow[], nowMs: number): string`; `fetchQuota(getAccessToken: () => Promise<string | undefined>, signal: AbortSignal, request?: typeof fetch): Promise<QuotaWindow[]>`.

- [x] Declare `node 24.18.0` in `.tool-versions`; review it before using `mise install`. Test with `mise exec -- node --test packages/codex-quota/test/quota.test.ts`.
- [x] Write fixtures with `rate_limit.primary_window` and `secondary_window`, using `limit_window_seconds` of `18000` or `604800`, `used_percent`, and `reset_at` in Unix seconds. Assert the exact sample footer with `62` and `25` used and resets `3h39m` and `5d14h` away. Assert weekly-only output when weekly is primary and 5h is absent. Assert invalid rows cannot produce quota, `100` used shows `0% left`, and a past reset displays `0m` rather than a negative duration.
- [x] With a fake access token and fetch, assert one GET to `https://chatgpt.com/backend-api/wham/usage`, with `Authorization`, `ChatGPT-Account-Id`, `redirect: "error"`, and the supplied abort signal. Assert no fetch for an absent token, token without the Codex account claim, or already-aborted request. Assert non-OK and unrecognized data reject without including response content or auth in the error.
- [x] Run the test file and confirm it fails for the missing implementation. Implement `quota.ts`: recognize valid windows by duration, require a finite percentage in `[0, 100]` and a positive integer reset timestamp, ignore unknown and malformed rows, sort 5h before weekly, and deduplicate window kinds. Format percent left rounded to an integer and show at most two duration units (`d`/`h` or `h`/`m`; minutes only below one hour). Decode `https://api.openai.com/auth.chatgpt_account_id` from the OAuth token’s JWT payload (the namespace key is `https://api.openai.com/auth`). Check cancellation after auth resolution, do not follow redirects, and reject an empty parse.
- [x] Rerun the test file; all tests should pass without credentials or network access.

### Task 2: Drive the footer without blocking Pi

**Files:** `packages/codex-quota/src/status.ts`, `packages/codex-quota/test/status.test.ts`.

**Consumes:** Task 1’s `QuotaWindow` and `formatQuota`.

**Produces:** `createQuotaStatus(loadQuota: (signal: AbortSignal) => Promise<QuotaWindow[]>, setStatus: (text: string | undefined) => void): { start(): void; afterTurn(): void; stop(): void }`. One controller belongs to one activation; create a fresh one on re-entry.

- [x] Add fake-clock tests: `start()` sets `quota loading…` synchronously; resolving the pending load changes it to the sample line. A request that never settles yields `quota unavailable` after 10 seconds. Failed later fetches keep the previous values with ` · stale`, and a later success removes the marker.
- [x] Assert that several completed turns before the initial request finishes or during its 60-second cooldown trigger just one follow-up at the next eligible time. Assert one minute of idle time changes the countdown without a fetch and that more idle time still does not fetch. Assert stop clears the text, aborts the load, cancels both timer types, and ignores a late success.
- [x] Run `mise exec -- node --test packages/codex-quota/test/status.test.ts` and confirm missing implementation failure. Implement the controller using `Date.now()` and Node timers. Throttle based on the last request’s start time. Remember one pending refresh while throttled or in flight; keep it separate from the local display tick. Race the load against the timeout so a hung auth lookup cannot hold the state indefinitely; pass cancellation to `fetchQuota` and ignore callbacks after stop. Use `node:test` mock timers for deterministic timing.
- [x] Rerun both test files; confirm they pass.

### Task 3: Wire and verify the Pi package

**Files:** `README.md`, `packages/codex-quota/{package.json,README.md}`, `packages/codex-quota/src/index.ts`, `packages/codex-quota/test/extension.test.ts`.

**Consumes:** `createQuotaStatus` and `fetchQuota` from Tasks 1–2, Pi’s `ExtensionAPI`.

**Produces:** Default-exported Pi extension; independently installable local package `pi-codex-quota`.

- [x] Write faked Pi hook tests: TUI Codex startup starts loading and calls `modelRegistry.getApiKeyForProvider("openai-codex")`; RPC/print and other providers do neither. Switching into Codex starts loading, switching between Codex models does not restart it, and switching out or shutting down clears it. Only `turn_end` events with `outcome === "completed"` and a Codex assistant message trigger the refresh. Use synthetic auth and intercept `fetch`; no real provider calls in tests.
- [x] Run `mise exec -- node --test packages/codex-quota/test/extension.test.ts` and confirm missing implementation failure. Implement `index.ts` using `session_start`, `model_select`, `turn_end`, and `session_shutdown`; require `ctx.mode === "tui"` and use the `codex-quota` status key. Keep event handlers non-blocking. Add a Pi manifest with `pi.extensions: ["./src/index.ts"]` and the `pi-package` keyword, and document `pi install "$PWD/packages/codex-quota"` from the repo root or temporary use via `pi -e ./packages/codex-quota`.
- [x] Run all tests with `mise exec -- node --test packages/codex-quota/test/*.test.ts`. Smoke-test Pi discovery via `printf '%s\n' '{"id":"smoke","type":"get_state"}' | pi --offline --no-session --no-extensions --mode rpc -e ./packages/codex-quota`; expect a successful `get_state` response and no extension load errors. This intentionally does not verify live quota; optionally verify the real footer in an interactive Pi session if requested.
- [x] Review the complete change, including new files, and run `git diff --check`. Report what ran and whether live quota was verified. Do not commit or publish.

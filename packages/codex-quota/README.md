# Codex quota for Pi

Adds a status line to Pi’s existing footer when the active model uses `openai-codex`. It shows `quota loading…` while the first check runs, then, for example:

```text
quota 5h 38% left (3h39m) · weekly 75% left (5d14h)
```

## Try or install

From the repository root, use Pi 1.6.0 or later and select a model from the `openai-codex` provider. The extension uses your existing Pi Codex login.

```sh
# Try for one session
pi -e ./packages/codex-quota

# Install for your Pi user from this checkout
pi install "$PWD/packages/codex-quota"
```

The install points to this checkout; keep it in place. To remove it, run `pi remove "$PWD/packages/codex-quota"` from the repository root.

The extension checks on startup or when switching to Codex, then after completed Codex turns (at most once per minute while Codex is selected). Countdown changes don’t require network requests. Only windows returned by ChatGPT are shown.

The ChatGPT usage endpoint is undocumented and may change. A failed first check shows `quota unavailable`; a failed refresh keeps the last values with a `stale` marker. The extension does not store quota data or manage credentials itself.

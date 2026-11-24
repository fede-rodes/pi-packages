# Pi Packages

A monorepo for independently installable Pi packages and skills.

| Package | Description |
| --- | --- |
| [Codex quota](packages/codex-quota/) | Shows remaining Codex subscription quota and reset times in Pi’s footer. |

Packages live in `packages/`; each has its own Pi manifest and install instructions.

## Development

Review `.tool-versions` before trusting it in mise. From the repository root:

```sh
mise trust .tool-versions
mise install
mise exec -- node --test packages/codex-quota/test/*.test.ts
```

Tests use simulated responses and do not require Codex credentials.

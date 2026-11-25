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
mise exec -- npm --prefix packages/codex-quota ci --ignore-scripts
mise exec -- node --test packages/codex-quota/test/*.test.ts
```

Tests use simulated responses and do not require Codex credentials.

## GitHub releases

To release Codex quota, bump the version in `packages/codex-quota/package.json`
and its `package-lock.json`, run the tests above, then commit and push the
release changes. From the repository root, check out that commit and make sure
`gh` is authenticated. Replace `0.1.1` and the release notes in this example:

```sh
version=0.1.1
tag="pi-codex-quota-v$version"
asset="pi-codex-quota-$version.tgz"
repo=fede-rodes/pi-packages

mise exec -- npm pack ./packages/codex-quota --ignore-scripts
tar -tzf "$asset"
gh release create "$tag" "$asset" --repo "$repo" \
  --target "$(git rev-parse HEAD)" --title "pi-codex-quota $version" \
  --notes "Describe what changed in this release."
gh release view "$tag" --repo "$repo" --json url,assets
```

The tarball is a GitHub release asset; don't commit it or publish it to npm as
part of this process.

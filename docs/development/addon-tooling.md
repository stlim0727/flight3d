# Addon starter and picker

Follow-up to PR #1046 / Discussion #1045. The addon contract, catalog validator,
set linter and share-profile helpers are already in `src/addons/`. This patch
adds the developer quick-start tooling and the in-app user picker.

## Developer quick start

```sh
node scripts/addon-dev.mjs init region --publisher demo --name my-pack --core 1.8.0 --out my-addon
cd my-addon
node /path/to/flight3d/scripts/addon-contract.mjs validate addon.json --core 1.8.0
node /path/to/flight3d/scripts/addon-contract.mjs lint-set addon.json --core 1.8.0
node /path/to/flight3d/scripts/addon-dev.mjs catalog addon.json <owner>/<repo>
```

`init` writes:

- `addon.json` — a kind-specific v1 manifest with valid identifiers and ranges;
- `catalog.json` — a single exact-version pin;
- `.github/workflows/validate-addon.yml` — the same CLI in CI;
- `README.md` — the remaining publisher steps.

Replace placeholder URLs (`packs.example`) and SHA-256 values before publishing.
`catalog` computes the manifest SHA-256 from the file and accepts either a full
HTTP(S) base URL or `owner/repo` shorthand for a GitHub repository. For the shorthand
it writes `https://raw.githubusercontent.com/<owner>/<repo>/main/addon.json`.
Binary asset checksums still need to be calculated by the publisher.

## User addon selection

The lobby **Options** tab contains an addon picker. Enter a catalog URL or
`<owner>/<repo>` for a GitHub-hosted addon, load it, filter by name or type, and
select compatible addons. **선택 공유 링크 만들기** produces a URL that carries
pinned addon versions and checksums through `profileShareParams()`; click the
generated URL or use **링크 복사**.

Catalog entries with invalid IDs, versions, URLs or checksums are rejected by
`validateCatalog()`. Entries marked `compatible: false` are displayed but cannot
be selected.

## Tests

```sh
node --test tests/addonTooling.test.js
```

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
node /path/to/flight3d/scripts/addon-dev.mjs catalog addon.json https://example.com/demo/region/my-pack/1.0.0
```

`init` writes:

- `addon.json` — a kind-specific v1 manifest with valid identifiers and ranges;
- `catalog.json` — a single exact-version pin;
- `.github/workflows/validate-addon.yml` — the same CLI in CI;
- `README.md` — the remaining publisher steps.

Replace placeholder URLs (`packs.example`) and SHA-256 values before publishing.
`catalog` computes the manifest SHA-256 from the file; binary asset checksums
still need to be calculated by the publisher.

## User addon selection

The lobby **Options** tab contains an addon picker. Paste a catalog URL, load
it, filter by name or type, select compatible addons, then click
**선택 공유 링크 만들기**. The generated URL carries pinned addon versions and
checksums through `profileShareParams()`, so the same flight can be shared.

Catalog entries with invalid IDs, versions, URLs or checksums are rejected by
`validateCatalog()`. Entries marked `compatible: false` are displayed but cannot
be selected.

## Tests

```sh
node --test tests/addonTooling.test.js
```

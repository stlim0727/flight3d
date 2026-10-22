# UI localization

Environment settings contain a Language / 언어 selector, and the main menu offers
English and 한국어 buttons directly. Changes take effect immediately without
restarting a flight, demo, or camera. The choice is saved under
`flight3d.language` in localStorage. On first
visit, the first supported browser language is used (`ko-KR` → `ko`, `en-US` →
`en`); unsupported browser languages fall back to English. Storage failures do
not prevent switching languages.

## Add a language

1. Copy `src/i18n/en.js` to a new locale file and translate the values. Keep keys
   and named placeholders such as `{value}` unchanged. Messages are plain text.
2. Import the file and register its language code, native label and messages in
   `locales` in `src/i18n/index.js`. The selector uses this registry automatically.
3. Add catalog coverage to `tests/i18n.test.js` and check the desktop and mobile
   layouts. Missing messages fall back to English.

Use `t(key, values)` for text needed immediately, and
`bindText(element, () => t(key, values))` for existing text that must respond to
language changes. Bindings retain the latest UI state and update existing nodes;
call `bindText` again when state changes. It also accepts an attribute name such
as `title` or `aria-label` as its third argument. Detached nodes are discarded
when switching languages.

HTML uses `data-i18n`, `data-i18n-title`, and `data-i18n-aria-label`. Call
`translateDOM(root)` after creating a dynamic panel. Keep translated spans around
text only to preserve buttons, icons, links and event listeners. Demo banners
and toast messages accept functions so active messages can be translated without
restarting a stage. Collision names/descriptions use getters so a retained crash
result changes language while collision codes and numeric data remain stable.

Standard aviation instruments, units, abbreviations and simulator diagnostic
codes (PFD, N1, KT, FLAPS, GEAR, TOWER, etc.) retain their conventional English
notation in both languages. Terrain source documents are source artifacts and
are not translated.

## Verification

Run `npm run check`, `npm test`, and `npm run build`. Browser acceptance should
switch languages on desktop and at 390 px mobile width, open the flight guide,
inspect diagnostics and touch tooltips, switch airport/audio/yoke states, change
languages during a demo and crash, and reload to verify the saved choice. Confirm
select keyboard input does not trigger flight or demo shortcuts.

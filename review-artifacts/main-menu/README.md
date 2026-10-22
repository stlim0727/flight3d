# Main menu polish acceptance

The menu now uses a 360px card, smaller type, consistent scenario rows, and a
native settings disclosure. Language lives in the header; the briefing follows
the flight choices. Touch targets remain at least 44px in compact mode.

## Verification

- `npm run check`: 161 JavaScript files and six pinned action references passed.
- `npm test`: 408 tests passed, zero failures.
- `npm run build`: passed after final HTML/CSS edits (existing chunk size advisory).
- Chrome CDP: English and Korean at 1440×900, 1024×768, 390×844, 320×568,
  568×320, and 844×390. All 12 layouts kept the card within the viewport with no
  horizontal overflow; scrolling brought Fly to an unobstructed hit-test position.
- Expanded settings remained reachable in landscape; scenario selection, Fly,
  and returning to the menu passed in the running application.

Screenshots show desktop Korean, portrait Korean, and expanded settings in
landscape. The simulator animation was stopped and its renderer pixel ratio
reduced during capture to avoid software WebGL capture stalls. DOM/menu sizing
used device scale factor 1. These are UI checks, not flight rendering or physical
device acceptance tests.

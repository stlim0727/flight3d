# Interactive cockpit shadow demo acceptance

Launch from Main menu → Scenarios → Cockpit shadow demo → Fly. The aircraft
holds its runway pose; the 3D cockpit stays active and drag looking remains
available. Six artificial sun directions loop every 36 seconds (4.5 second hold,
1.5 second smooth transition). Previous/Next, Pause/Resume and Exit are available.
Normal pause and the main menu hold the clock. Exit restores the previous cloud
cover, time and camera and opens the main menu.

Verification: `npm run check`, all 411 Node tests and `npm run build` passed.
`scripts/verify-shadow-demo.mjs` passed actual scenario-button entry, six rendered
sun directions, unchanged aircraft position, changed cockpit pixels, manual steps
while paused, automatic looping, portrait layout and exit restoration. See
`report.json` and `sun-1.png` through `sun-6.png`. The changed-pixel count samples
the lower cockpit image region, not the outside sky. Screenshot `scenario-menu.png`
shows selection; `portrait.png` shows all demo controls within a 390×844 viewport.

Chrome work used a persistent shared `chrome-session hold` lease. The shared
daemon was software-rendered; its owned test tab was closed, then an isolated
ANGLE Vulkan GPU browser ran this same workflow under that lease. The shared
daemon was preserved. The browser harness creates and closes its own tab.

Reproduce with Vite and GPU Chrome under a shared Chrome session as documented
in `docs/development/cockpit-sunlight.md`, then run:

```
APP_URL=http://127.0.0.1:5292 CDP_PORT=9484 chrome-session node scripts/verify-shadow-demo.mjs
```

An already-held persistent lease uses the Node command directly. The screenshot
run exercises Coastal airport. The scenario is registered for both Coastal and
Lukla; Node tests cover all scenario labels/availability in English and Korean.
The existing Vite large-bundle warning remains.

# Touch stick response

The thumb stick uses relative drag: each new pointer starts at neutral, even when
it lands away from the visual centre. Pointer capture allows full travel beyond
the panel; only the owning pointer may move or release it. Cancel and lost capture
release the input too.

A radial 6% deadzone is followed by `0.35 * travel + 0.65 * travel^3`, with travel
rescaled from the deadzone edge to full deflection. The curve preserves direction
and maximum authority. On the 88px compact panel (24px effective radius), a 5px
single-axis movement commands about 5.8%, rather than the previous 20.8%.
The curve applies to the thumb stick; gyro calibration and mapping are separate.

When a touch axis returns to zero, its surface input slews back at 4 normalized
units/second (about 0.25s from full input). A keyboard, mouse or virtual override
cancels that axis's accelerated return. Ordinary command slew and aerodynamic
angular damping are unchanged. Returning the input to neutral does not level the
wings or instantly stop the aircraft's rotation. These are touch ergonomics,
not a validated F-16 FLCS or a G/roll-rate command model.

Run the sequence tests with:

```sh
node --test tests/flightControls.test.js tests/touchControlState.test.js
```

For real browser pointer delivery, start Vite on 5286 and run:

```sh
chrome-session --project flight3d node scripts/verify-touch-stick.mjs
```

`APP_URL` and `ARTIFACT_DIR` override the URL and `.cache/touch-stick` output.
The check waits for startup, selects the F-16, freezes physics and drives native
CDP touch events in portrait and landscape. It checks off-centre grabs, fine and
full inputs, release and cancellation, and saves screenshots/results. Physics is
stepped only through `FlightControls.update`; this is input acceptance, not a
full flight handling or landing test. Inspect the images separately.

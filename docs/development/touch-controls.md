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

For the separate B738/C172 approach/cruise audit with live 120 Hz physics,
see [aircraft control evidence](../../review-artifacts/aircraft-controls/README.md)
and `scripts/verify-aircraft-controls.mjs`.

## Gyro access recovery

GYRO requests permission in the button gesture on browsers that expose
`DeviceOrientationEvent.requestPermission()`. It shows a checking state until a
finite beta/gamma reading arrives; after four seconds without usable readings it
returns the stick to neutral and opens recovery help. Denied requests, exceptions,
insecure contexts and missing APIs use the same help dialog with distinct reasons.

Help offers Android Brave, Android Chrome, iPhone/iPad and generic instructions,
with a manual browser selector because privacy settings can conceal identity.
Brave's optional `navigator.brave.isBrave()` is used as a best-effort hint only.
Retry starts a fresh sensor check after returning from browser settings; Use touch
controls closes the dialog. No browser-internal settings links are attempted.
English and Korean labels update with the selected language.

Run `node --test tests/gyroPermission.test.js tests/touchControlState.test.js`
for permission, no-reading timeout, retry, cancellation, browser hints and help
interaction sequences. These use simulated readings; real Android Brave and iOS
permission/settings behavior still requires a physical device check.

## Gyro orientation and calibration

While gyro is enabled, the menu shows Follow screen / Portrait / Landscape and
Re-center gyro. Portrait/Landscape request the browser's orientation lock. If the
API is unavailable or rejects the request (for example, outside fullscreen), the
menu explains how to use the device rotation lock. The app does not enter
fullscreen automatically. Disabling gyro or selecting Follow screen releases any
lock acquired by gyro. Selecting a mode remains safe even when locking fails:
the gyro commands neutral while the actual screen orientation does not match.

The first reading after 600 ms establishes the comfortable holding position as
neutral. Re-center, screen orientation events, or a changed screen angle/type
clear calibration and command neutral during another 600 ms settling period.
Automatic recalibration on rotation prevents a portrait neutral from becoming a
full-scale landscape input. This centers control inputs; it does not level the
aircraft or pause flight.

Mapping projects the device gravity vector into screen axes using the screen
angle. Device beta/gamma are never directly subtracted, avoiding Euler-coordinate
jumps at landscape boundaries. At screen angle +90 degrees, device +x points to
screen top and device +y points to screen left: screen pitch follows -gamma and
screen roll follows +beta near the flat pose. The opposite landscape direction
reverses those axes. Screen orientation type, rather than angle alone, determines
portrait/landscape matching so natural-landscape tablets are supported too.

`tests/gyroOrientation.test.js` exercises both landscape directions, upside-down
portrait, equivalent sensor representations, short angle wrapping, rotation and
re-centering sequences, mismatched screens, rejected locks and overlapping lock
requests. Real-phone browser/OS rotation behavior still requires device testing.

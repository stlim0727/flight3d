# Simulator preferences on reload

`flight3d.preferences.v1` stores explicitly chosen time of day, audio mute state,
touch-control visibility, and the demo profile of the last flight started. The
existing airport/aircraft/scenario, graphics-quality and language storage keys
remain in place; URL flight choices still override saved flight selection.

Preferences restore before UI binding and automatic flight start. Restored time
updates sky, foliage and water, and marks the demo director's user-time override
so its first stage cannot immediately replace the saved hour. Menu and keyboard
time changes use the same persistent `setTimeOfDay` path. Scripted demo and
shadow-demo times do not write preferences; Han River's temporary sunset and
restoration explicitly pass `{ persist: false }`.

Sound restores without requesting a new audio context. Missing touch preferences
retain device detection; explicit false keeps touch controls hidden after reload.
Restoring touch visibility does not enable gyro input or request sensor permission.
The lobby resolves saved demo profiles against the selected airport/aircraft.
Like flight selection, demo profile is saved when a flight starts, so browsing
pending menu choices does not replace the last flown selection.

Reads validate each field and ignore malformed data. Partial writes merge valid
fields to avoid losing time when changing sound or touch visibility. Blocked
storage or quota failures leave the current session usable. In-flight controls,
aircraft pose, pause state and temporary scenario state are not preferences.

Regression coverage: `tests/simulatorPreferences.test.js` exercises midnight,
false toggles, independent updates, corrupt/unavailable storage, startup restoration
and protection against demo time overrides, plus the keyboard time path.

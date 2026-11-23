/**
 * Fold-up animation length for the pilotage map, in milliseconds. Matches the
 * 0.45 s fold rustle (`paperMapSound.js`) and the `map-fold` keyframes in
 * `flight-panels.css`; the unfold keyframes likewise follow the 0.6 s rustle.
 */
export const MAP_FOLD_MS = 450;

/**
 * Wires the paper map `<details>` so a pilot's fold plays the fold-up
 * animation before the sheet actually closes. Opening keeps the native toggle:
 * the CSS unfold animation starts as soon as the sheet renders.
 *
 * The rustle callbacks keep the earlier contract: `onUnfold` once per open,
 * `onFold` once per fold the pilot asked for (summary click, which the M key
 * and Enter/Space also raise), never when the game closes the sheet (crash,
 * leaving the flight) or for the north/heading-up button inside the paper.
 */
export function bindPilotageMapFold(map, {
  onUnfold, onFold, reduceMotion = null,
  setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  let pilotToggled = false;
  let foldTimer = null;
  const stopFolding = () => {
    if (foldTimer !== null) clearTimer(foldTimer);
    foldTimer = null;
    map.classList.remove('is-folding');
  };
  map.querySelector('summary')?.addEventListener('click', event => {
    // A second tap mid-fold would reopen the half-folded sheet; let it finish.
    if (foldTimer !== null) {
      event.preventDefault();
      return;
    }
    if (map.open && !reduceMotion?.matches) {
      event.preventDefault();
      onFold?.();
      map.classList.add('is-folding');
      foldTimer = setTimer(() => {
        // Same task: the sheet closes before the next frame, so the unfolded
        // map never flashes back between the animation and `open = false`.
        stopFolding();
        map.open = false;
      }, MAP_FOLD_MS);
      return;
    }
    pilotToggled = true;
  });
  map.addEventListener('toggle', () => {
    if (map.open) onUnfold?.();
    else {
      // A crash or leaving the flight mid-fold closes the sheet at once.
      stopFolding();
      if (pilotToggled) onFold?.();
    }
    pilotToggled = false;
  });
  return { get folding() { return foldTimer !== null; } };
}

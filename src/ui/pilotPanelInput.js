/** Form focus releases flight keys; keyup must still reach normal controls. */
export function bindPilotPanelInput(shell, controls) {
  shell.addEventListener('focusin', () => controls.releaseAllKeys());
  shell.addEventListener('keydown', event => {
    if (event.target.closest('textarea,input,select')) event.stopPropagation();
  });
}
